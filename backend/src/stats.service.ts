import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import type { DrizzleDatabase } from './db/client';
import { DRIZZLE_DB_READ, ReadDatabaseRouter } from './db/database.module';
import { eventsTable } from './db/schema';
import { KafkaService } from './kafka.service';

export type LatestEventRow = {
  id: string;
  user_id: string;
  event_type: string;
  processed_by: string;
  kafka_partition: number;
  kafka_topic: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type StatsSnapshot = {
  instanceId: string;
  localConsumed: number;
  totalEvents: number;
  eventsPerSecond: number;
  latestEventAt: string | null;
};

export type ThroughputPoint = {
  bucket_start: string;
  count: number;
};

export type EventTypeDistributionRow = {
  event_type: string;
  count: number;
};

export type TopicDistributionRow = {
  kafka_topic: string;
  count: number;
};

export type PartitionDistributionRow = {
  kafka_topic: string;
  kafka_partition: number;
  count: number;
};

export type InstanceDistributionRow = {
  processed_by: string;
  count: number;
};

export type PartitionOwnershipRow = {
  kafka_topic: string;
  kafka_partition: number;
  processed_by: string;
  count: number;
};

export type DashboardAnalyticsSnapshot = {
  generated_at: string;
  window_minutes: number;
  bucket_seconds: number;
  processed_by_filter: string | null;
  total_events_in_window: number;
  throughput: ThroughputPoint[];
  event_type_distribution: EventTypeDistributionRow[];
  topic_distribution: TopicDistributionRow[];
  partition_distribution: PartitionDistributionRow[];
  instance_distribution: InstanceDistributionRow[];
  partition_ownership: PartitionOwnershipRow[];
};

export type DashboardAnalyticsOptions = {
  windowMinutes?: number;
  bucketSeconds?: number;
  processedBy?: string;
};

export type AggregateRangeKey = '24h' | '7d' | '30d' | '365d' | '5y';
export type AggregateBucketKey = '1h' | '1d' | '1m' | '1y';

export type AggregateSeriesPoint = {
  bucket_start: string;
  count: number;
};

export type WeekdayDistributionRow = {
  weekday: number;
  label: string;
  count: number;
};

export type HourDistributionRow = {
  hour: number;
  count: number;
};

export type DashboardAggregateSnapshot = {
  generated_at: string;
  range_key: AggregateRangeKey;
  bucket_key: AggregateBucketKey;
  top_n: number;
  processed_by_filter: string | null;
  total_events: number;
  previous_period_total_events: number;
  delta_percentage_vs_previous: number | null;
  unique_users: number;
  average_events_per_bucket: number;
  series: AggregateSeriesPoint[];
  event_type_distribution: EventTypeDistributionRow[];
  topic_distribution: TopicDistributionRow[];
  instance_distribution: InstanceDistributionRow[];
  weekday_distribution: WeekdayDistributionRow[];
  hour_distribution: HourDistributionRow[];
};

export type DashboardAggregateOptions = {
  rangeKey?: string;
  bucketKey?: string;
  topN?: number;
  processedBy?: string;
};

type IntervalUnit = 'hour' | 'day' | 'month' | 'year';

type AggregateRangeConfig = {
  amount: number;
  unit: IntervalUnit;
};

type AggregateBucketConfig = {
  dateTrunc: IntervalUnit;
  unit: IntervalUnit;
};

const DEFAULT_WINDOW_MINUTES = 15;
const DEFAULT_BUCKET_SECONDS = 10;
const MAX_WINDOW_MINUTES = 120;
const MAX_BUCKET_SECONDS = 60;
const MAX_EVENT_TYPE_BARS = 8;
const DEFAULT_AGGREGATE_RANGE_KEY: AggregateRangeKey = '30d';
const DEFAULT_AGGREGATE_BUCKET_KEY: AggregateBucketKey = '1d';
const DEFAULT_AGGREGATE_TOP_N = 8;
const MAX_AGGREGATE_TOP_N = 20;
const MAX_AGGREGATE_SERIES_POINTS = 2500;
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const AGGREGATE_RANGE_CONFIG: Record<AggregateRangeKey, AggregateRangeConfig> = {
  '24h': { amount: 24, unit: 'hour' },
  '7d': { amount: 7, unit: 'day' },
  '30d': { amount: 30, unit: 'day' },
  '365d': { amount: 365, unit: 'day' },
  '5y': { amount: 5, unit: 'year' },
};

const AGGREGATE_BUCKET_CONFIG: Record<AggregateBucketKey, AggregateBucketConfig> = {
  '1h': { dateTrunc: 'hour', unit: 'hour' },
  '1d': { dateTrunc: 'day', unit: 'day' },
  '1m': { dateTrunc: 'month', unit: 'month' },
  '1y': { dateTrunc: 'year', unit: 'year' },
};

@Injectable()
export class StatsService {
  constructor(
    @Inject(DRIZZLE_DB_READ)
    private readonly readDatabaseRouter: ReadDatabaseRouter,
    @Inject(KafkaService) private readonly kafkaService: KafkaService,
  ) {}

  private getReadDatabase(): DrizzleDatabase {
    return this.readDatabaseRouter.getDatabase();
  }

  async getLatestEvents(limit = 100, processedBy?: string): Promise<LatestEventRow[]> {
    const db = this.getReadDatabase();
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const normalizedInstance = this.normalizeInstanceFilter(processedBy);
    const baseQuery = db
      .select({
        id: eventsTable.id,
        user_id: eventsTable.userId,
        event_type: eventsTable.eventType,
        processed_by: eventsTable.processedBy,
        kafka_partition: eventsTable.kafkaPartition,
        kafka_topic: eventsTable.kafkaTopic,
        payload: eventsTable.payload,
        created_at: eventsTable.createdAt,
      })
      .from(eventsTable);

    const rows = await (normalizedInstance
      ? baseQuery.where(eq(eventsTable.processedBy, normalizedInstance))
      : baseQuery)
      .orderBy(desc(eventsTable.createdAt))
      .limit(safeLimit);

    return rows.map((row: {
      id: string;
      user_id: string;
      event_type: string;
      processed_by: string;
      kafka_partition: number;
      kafka_topic: string;
      payload: Record<string, unknown> | null;
      created_at: Date;
    }) => ({
      id: row.id,
      user_id: row.user_id,
      event_type: row.event_type,
      processed_by: row.processed_by,
      kafka_partition: row.kafka_partition,
      kafka_topic: row.kafka_topic,
      payload: row.payload ?? {},
      created_at: row.created_at.toISOString(),
    }));
  }

  async getSnapshot(): Promise<StatsSnapshot> {
    const db = this.getReadDatabase();

    const [totalResult] = await db
      .select({
        total: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable);

    const [epsResult] = await db
      .select({
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(sql`${eventsTable.createdAt} >= NOW() - INTERVAL '1 second'`);

    const [latestResult] = await db
      .select({
        latest: sql<string | null>`MAX(${eventsTable.createdAt})::text`,
      })
      .from(eventsTable);

    return {
      instanceId: process.env.INSTANCE_ID ?? 'backend',
      localConsumed: this.kafkaService.getLocalConsumedCount(),
      totalEvents: Number(totalResult?.total ?? 0),
      eventsPerSecond: Number(epsResult?.count ?? 0),
      latestEventAt: latestResult?.latest ?? null,
    };
  }

  async getDashboardAnalytics(
    options: DashboardAnalyticsOptions = {},
  ): Promise<DashboardAnalyticsSnapshot> {
    const db = this.getReadDatabase();
    const windowMinutes = this.clamp(options.windowMinutes, 1, MAX_WINDOW_MINUTES, DEFAULT_WINDOW_MINUTES);
    const bucketSeconds = this.clamp(options.bucketSeconds, 1, MAX_BUCKET_SECONDS, DEFAULT_BUCKET_SECONDS);
    const processedBy = this.normalizeInstanceFilter(options.processedBy);
    const whereClause = this.buildWindowWhere(windowMinutes, processedBy);
    const bucketEpochExpression = sql<number>`floor(extract(epoch from ${eventsTable.createdAt}) / ${bucketSeconds}) * ${bucketSeconds}`;

    const throughputRows = await db
      .select({
        bucket_epoch: bucketEpochExpression,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(whereClause)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    const eventTypeRows = await db
      .select({
        event_type: eventsTable.eventType,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(whereClause)
      .groupBy(eventsTable.eventType);

    const topicRows = await db
      .select({
        kafka_topic: eventsTable.kafkaTopic,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(whereClause)
      .groupBy(eventsTable.kafkaTopic);

    const partitionRows = await db
      .select({
        kafka_topic: eventsTable.kafkaTopic,
        kafka_partition: eventsTable.kafkaPartition,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(whereClause)
      .groupBy(eventsTable.kafkaTopic, eventsTable.kafkaPartition)
      .orderBy(eventsTable.kafkaTopic, eventsTable.kafkaPartition);

    const instanceRows = await db
      .select({
        processed_by: eventsTable.processedBy,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(whereClause)
      .groupBy(eventsTable.processedBy);

    const ownershipRows = await db
      .select({
        kafka_topic: eventsTable.kafkaTopic,
        kafka_partition: eventsTable.kafkaPartition,
        processed_by: eventsTable.processedBy,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(whereClause)
      .groupBy(eventsTable.kafkaTopic, eventsTable.kafkaPartition, eventsTable.processedBy)
      .orderBy(eventsTable.kafkaTopic, eventsTable.kafkaPartition, eventsTable.processedBy);

    const [windowTotalResult] = await db
      .select({
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(whereClause);

    return {
      generated_at: new Date().toISOString(),
      window_minutes: windowMinutes,
      bucket_seconds: bucketSeconds,
      processed_by_filter: processedBy,
      total_events_in_window: Number(windowTotalResult?.count ?? 0),
      throughput: this.fillThroughputGaps(
        throughputRows.map((row: { bucket_epoch: number | string; count: string }) => ({
          bucketEpoch: Number(row.bucket_epoch),
          count: Number(row.count),
        })),
        windowMinutes,
        bucketSeconds,
      ),
      event_type_distribution: eventTypeRows
        .map((row: { event_type: string; count: string }) => ({
          event_type: row.event_type,
          count: Number(row.count),
        }))
        .sort((left, right) => right.count - left.count)
        .slice(0, MAX_EVENT_TYPE_BARS),
      topic_distribution: topicRows
        .map((row: { kafka_topic: string; count: string }) => ({
          kafka_topic: row.kafka_topic,
          count: Number(row.count),
        }))
        .sort((left, right) => right.count - left.count),
      partition_distribution: partitionRows.map(
        (row: { kafka_topic: string; kafka_partition: number; count: string }) => ({
          kafka_topic: row.kafka_topic,
          kafka_partition: row.kafka_partition,
          count: Number(row.count),
        }),
      ),
      instance_distribution: instanceRows
        .map((row: { processed_by: string; count: string }) => ({
          processed_by: row.processed_by,
          count: Number(row.count),
        }))
        .sort((left, right) => right.count - left.count),
      partition_ownership: ownershipRows.map(
        (row: { kafka_topic: string; kafka_partition: number; processed_by: string; count: string }) => ({
          kafka_topic: row.kafka_topic,
          kafka_partition: row.kafka_partition,
          processed_by: row.processed_by,
          count: Number(row.count),
        }),
      ),
    };
  }

  async getDashboardAggregates(
    options: DashboardAggregateOptions = {},
  ): Promise<DashboardAggregateSnapshot> {
    const db = this.getReadDatabase();
    const rangeKey = this.normalizeAggregateRangeKey(options.rangeKey);
    const bucketKey = this.normalizeAggregateBucketKey(options.bucketKey);
    const topN = this.clamp(options.topN, 1, MAX_AGGREGATE_TOP_N, DEFAULT_AGGREGATE_TOP_N);
    const processedBy = this.normalizeInstanceFilter(options.processedBy);
    const rangeConfig = AGGREGATE_RANGE_CONFIG[rangeKey];
    const bucketConfig = AGGREGATE_BUCKET_CONFIG[bucketKey];
    const currentWhereClause = this.buildRangeWhere(rangeConfig, processedBy);
    const previousWhereClause = this.buildPreviousRangeWhere(rangeConfig, processedBy);

    const seriesRows = await db
      .select({
        bucket_start: sql<string>`date_trunc(${bucketConfig.dateTrunc}, ${eventsTable.createdAt})::text`,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(currentWhereClause)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    const eventTypeRows = await db
      .select({
        event_type: eventsTable.eventType,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(currentWhereClause)
      .groupBy(eventsTable.eventType);

    const topicRows = await db
      .select({
        kafka_topic: eventsTable.kafkaTopic,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(currentWhereClause)
      .groupBy(eventsTable.kafkaTopic);

    const instanceRows = await db
      .select({
        processed_by: eventsTable.processedBy,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(currentWhereClause)
      .groupBy(eventsTable.processedBy);

    const weekdayRows = await db
      .select({
        weekday: sql<number>`extract(dow from ${eventsTable.createdAt})::int`,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(currentWhereClause)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    const hourRows = await db
      .select({
        hour: sql<number>`extract(hour from ${eventsTable.createdAt})::int`,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(currentWhereClause)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    const [totalsResult] = await db
      .select({
        total: sql<string>`COUNT(*)::text`,
        unique_users: sql<string>`COUNT(DISTINCT ${eventsTable.userId})::text`,
      })
      .from(eventsTable)
      .where(currentWhereClause);

    const [previousTotalsResult] = await db
      .select({
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(previousWhereClause);

    const totalEvents = Number(totalsResult?.total ?? 0);
    const previousPeriodTotalEvents = Number(previousTotalsResult?.count ?? 0);
    const deltaPercentageVsPrevious =
      previousPeriodTotalEvents > 0
        ? Number((((totalEvents - previousPeriodTotalEvents) / previousPeriodTotalEvents) * 100).toFixed(2))
        : null;

    const series = this.fillAggregateSeriesGaps(seriesRows, rangeConfig, bucketConfig);

    return {
      generated_at: new Date().toISOString(),
      range_key: rangeKey,
      bucket_key: bucketKey,
      top_n: topN,
      processed_by_filter: processedBy,
      total_events: totalEvents,
      previous_period_total_events: previousPeriodTotalEvents,
      delta_percentage_vs_previous: deltaPercentageVsPrevious,
      unique_users: Number(totalsResult?.unique_users ?? 0),
      average_events_per_bucket:
        series.length > 0 ? Number((totalEvents / series.length).toFixed(2)) : 0,
      series,
      event_type_distribution: eventTypeRows
        .map((row: { event_type: string; count: string }) => ({
          event_type: row.event_type,
          count: Number(row.count),
        }))
        .sort((left, right) => right.count - left.count)
        .slice(0, topN),
      topic_distribution: topicRows
        .map((row: { kafka_topic: string; count: string }) => ({
          kafka_topic: row.kafka_topic,
          count: Number(row.count),
        }))
        .sort((left, right) => right.count - left.count)
        .slice(0, topN),
      instance_distribution: instanceRows
        .map((row: { processed_by: string; count: string }) => ({
          processed_by: row.processed_by,
          count: Number(row.count),
        }))
        .sort((left, right) => right.count - left.count),
      weekday_distribution: this.fillWeekdayDistribution(weekdayRows),
      hour_distribution: this.fillHourDistribution(hourRows),
    };
  }

  private buildWindowWhere(windowMinutes: number, processedBy: string | null) {
    if (processedBy) {
      return sql<boolean>`${eventsTable.createdAt} >= NOW() - (${windowMinutes} * INTERVAL '1 minute') AND ${eventsTable.processedBy} = ${processedBy}`;
    }

    return sql<boolean>`${eventsTable.createdAt} >= NOW() - (${windowMinutes} * INTERVAL '1 minute')`;
  }

  private fillThroughputGaps(
    rows: Array<{ bucketEpoch: number; count: number }>,
    windowMinutes: number,
    bucketSeconds: number,
  ): ThroughputPoint[] {
    const bucketMs = bucketSeconds * 1000;
    const endBucketMs = Math.floor(Date.now() / bucketMs) * bucketMs;
    const startBucketMs = endBucketMs - windowMinutes * 60 * 1000 + bucketMs;
    const pointsByEpoch = new Map<number, number>();

    for (const row of rows) {
      if (Number.isFinite(row.bucketEpoch)) {
        pointsByEpoch.set(row.bucketEpoch, row.count);
      }
    }

    const result: ThroughputPoint[] = [];

    for (let cursorMs = startBucketMs; cursorMs <= endBucketMs; cursorMs += bucketMs) {
      const epochSeconds = Math.floor(cursorMs / 1000);
      result.push({
        bucket_start: new Date(cursorMs).toISOString(),
        count: pointsByEpoch.get(epochSeconds) ?? 0,
      });
    }

    return result;
  }

  private buildRangeWhere(range: AggregateRangeConfig, processedBy: string | null) {
    const rangeInterval = this.buildIntervalExpression(range.amount, range.unit);

    if (processedBy) {
      return sql<boolean>`${eventsTable.createdAt} >= NOW() - ${rangeInterval} AND ${eventsTable.processedBy} = ${processedBy}`;
    }

    return sql<boolean>`${eventsTable.createdAt} >= NOW() - ${rangeInterval}`;
  }

  private buildPreviousRangeWhere(range: AggregateRangeConfig, processedBy: string | null) {
    const startInterval = this.buildIntervalExpression(range.amount * 2, range.unit);
    const endInterval = this.buildIntervalExpression(range.amount, range.unit);

    if (processedBy) {
      return sql<boolean>`${eventsTable.createdAt} >= NOW() - ${startInterval} AND ${eventsTable.createdAt} < NOW() - ${endInterval} AND ${eventsTable.processedBy} = ${processedBy}`;
    }

    return sql<boolean>`${eventsTable.createdAt} >= NOW() - ${startInterval} AND ${eventsTable.createdAt} < NOW() - ${endInterval}`;
  }

  private buildIntervalExpression(amount: number, unit: IntervalUnit) {
    switch (unit) {
      case 'hour':
        return sql`${amount} * INTERVAL '1 hour'`;
      case 'day':
        return sql`${amount} * INTERVAL '1 day'`;
      case 'month':
        return sql`${amount} * INTERVAL '1 month'`;
      case 'year':
        return sql`${amount} * INTERVAL '1 year'`;
    }
  }

  private fillAggregateSeriesGaps(
    rows: Array<{ bucket_start: string; count: string }>,
    rangeConfig: AggregateRangeConfig,
    bucketConfig: AggregateBucketConfig,
  ): AggregateSeriesPoint[] {
    const pointsByIso = new Map<string, number>();

    for (const row of rows) {
      const candidateDate = new Date(row.bucket_start);

      if (Number.isNaN(candidateDate.getTime())) {
        continue;
      }

      const normalizedDate = this.alignToBucketStart(candidateDate, bucketConfig.dateTrunc);
      pointsByIso.set(normalizedDate.toISOString(), Number(row.count));
    }

    const end = this.alignToBucketStart(new Date(), bucketConfig.dateTrunc);
    const start = this.alignToBucketStart(
      this.shiftDate(end, -rangeConfig.amount, rangeConfig.unit),
      bucketConfig.dateTrunc,
    );

    const result: AggregateSeriesPoint[] = [];
    let cursor = new Date(start);
    let guard = 0;

    while (cursor <= end && guard < 100_000) {
      const key = cursor.toISOString();
      result.push({
        bucket_start: key,
        count: pointsByIso.get(key) ?? 0,
      });

      cursor = this.incrementDate(cursor, bucketConfig.unit);
      guard += 1;
    }

    return this.downsampleSeries(result, MAX_AGGREGATE_SERIES_POINTS);
  }

  private downsampleSeries(
    points: AggregateSeriesPoint[],
    maxPoints: number,
  ): AggregateSeriesPoint[] {
    if (points.length <= maxPoints) {
      return points;
    }

    const stride = Math.ceil(points.length / maxPoints);

    return points.filter(
      (_point, index) => index % stride === 0 || index === points.length - 1,
    );
  }

  private fillWeekdayDistribution(
    rows: Array<{ weekday: number | string; count: string }>,
  ): WeekdayDistributionRow[] {
    const countsByWeekday = new Map<number, number>();

    for (const row of rows) {
      countsByWeekday.set(Number(row.weekday), Number(row.count));
    }

    return WEEKDAY_LABELS.map((label, weekday) => ({
      weekday,
      label,
      count: countsByWeekday.get(weekday) ?? 0,
    }));
  }

  private fillHourDistribution(
    rows: Array<{ hour: number | string; count: string }>,
  ): HourDistributionRow[] {
    const countsByHour = new Map<number, number>();

    for (const row of rows) {
      countsByHour.set(Number(row.hour), Number(row.count));
    }

    return Array.from({ length: 24 }, (_value, hour) => ({
      hour,
      count: countsByHour.get(hour) ?? 0,
    }));
  }

  private alignToBucketStart(date: Date, bucketUnit: IntervalUnit): Date {
    const aligned = new Date(date);

    switch (bucketUnit) {
      case 'hour':
        aligned.setUTCMinutes(0, 0, 0);
        return aligned;
      case 'day':
        aligned.setUTCHours(0, 0, 0, 0);
        return aligned;
      case 'month':
        aligned.setUTCDate(1);
        aligned.setUTCHours(0, 0, 0, 0);
        return aligned;
      case 'year':
        aligned.setUTCMonth(0, 1);
        aligned.setUTCHours(0, 0, 0, 0);
        return aligned;
    }
  }

  private incrementDate(date: Date, unit: IntervalUnit): Date {
    return this.shiftDate(date, 1, unit);
  }

  private shiftDate(date: Date, amount: number, unit: IntervalUnit): Date {
    const shifted = new Date(date);

    switch (unit) {
      case 'hour':
        shifted.setUTCHours(shifted.getUTCHours() + amount);
        return shifted;
      case 'day':
        shifted.setUTCDate(shifted.getUTCDate() + amount);
        return shifted;
      case 'month':
        shifted.setUTCMonth(shifted.getUTCMonth() + amount);
        return shifted;
      case 'year':
        shifted.setUTCFullYear(shifted.getUTCFullYear() + amount);
        return shifted;
    }
  }

  private normalizeAggregateRangeKey(value?: string): AggregateRangeKey {
    if (value && Object.prototype.hasOwnProperty.call(AGGREGATE_RANGE_CONFIG, value)) {
      return value as AggregateRangeKey;
    }

    return DEFAULT_AGGREGATE_RANGE_KEY;
  }

  private normalizeAggregateBucketKey(value?: string): AggregateBucketKey {
    if (value && Object.prototype.hasOwnProperty.call(AGGREGATE_BUCKET_CONFIG, value)) {
      return value as AggregateBucketKey;
    }

    return DEFAULT_AGGREGATE_BUCKET_KEY;
  }

  private clamp(value: number | undefined, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) {
      return fallback;
    }

    return Math.min(Math.max(Number(value), min), max);
  }

  private normalizeInstanceFilter(value?: string): string | null {
    const trimmed = value?.trim();
    return trimmed && trimmed.toLowerCase() !== 'all' ? trimmed : null;
  }
}
