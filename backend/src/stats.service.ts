import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import type { DrizzleDatabase } from './db/client';
import { DRIZZLE_DB } from './db/database.module';
import { eventsTable } from './db/schema';
import { KafkaService } from './kafka.service';

export type LatestEventRow = {
  id: string;
  user_id: string;
  event_type: string;
  processed_by: string;
  kafka_partition: number;
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

export type PartitionDistributionRow = {
  kafka_partition: number;
  count: number;
};

export type InstanceDistributionRow = {
  processed_by: string;
  count: number;
};

export type PartitionOwnershipRow = {
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
  partition_distribution: PartitionDistributionRow[];
  instance_distribution: InstanceDistributionRow[];
  partition_ownership: PartitionOwnershipRow[];
};

export type DashboardAnalyticsOptions = {
  windowMinutes?: number;
  bucketSeconds?: number;
  processedBy?: string;
};

const DEFAULT_WINDOW_MINUTES = 15;
const DEFAULT_BUCKET_SECONDS = 10;
const MAX_WINDOW_MINUTES = 120;
const MAX_BUCKET_SECONDS = 60;
const MAX_EVENT_TYPE_BARS = 8;

@Injectable()
export class StatsService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDatabase,
    @Inject(KafkaService) private readonly kafkaService: KafkaService,
  ) {}

  async getLatestEvents(limit = 100, processedBy?: string): Promise<LatestEventRow[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const normalizedInstance = this.normalizeInstanceFilter(processedBy);
    const baseQuery = this.db
      .select({
        id: eventsTable.id,
        user_id: eventsTable.userId,
        event_type: eventsTable.eventType,
        processed_by: eventsTable.processedBy,
        kafka_partition: eventsTable.kafkaPartition,
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
      payload: Record<string, unknown> | null;
      created_at: Date;
    }) => ({
      id: row.id,
      user_id: row.user_id,
      event_type: row.event_type,
      processed_by: row.processed_by,
      kafka_partition: row.kafka_partition,
      payload: row.payload ?? {},
      created_at: row.created_at.toISOString(),
    }));
  }

  async getSnapshot(): Promise<StatsSnapshot> {
    const [totalResult] = await this.db
      .select({
        total: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable);

    const [epsResult] = await this.db
      .select({
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(sql`${eventsTable.createdAt} >= NOW() - INTERVAL '1 second'`);

    const [latestResult] = await this.db
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
    const windowMinutes = this.clamp(options.windowMinutes, 1, MAX_WINDOW_MINUTES, DEFAULT_WINDOW_MINUTES);
    const bucketSeconds = this.clamp(options.bucketSeconds, 1, MAX_BUCKET_SECONDS, DEFAULT_BUCKET_SECONDS);
    const processedBy = this.normalizeInstanceFilter(options.processedBy);
    const whereClause = this.buildWindowWhere(windowMinutes, processedBy);
    const bucketEpochExpression = sql<number>`floor(extract(epoch from ${eventsTable.createdAt}) / ${bucketSeconds}) * ${bucketSeconds}`;

    const throughputRows = await this.db
      .select({
        bucket_epoch: bucketEpochExpression,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(whereClause)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    const eventTypeRows = await this.db
      .select({
        event_type: eventsTable.eventType,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(whereClause)
      .groupBy(eventsTable.eventType);

    const partitionRows = await this.db
      .select({
        kafka_partition: eventsTable.kafkaPartition,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(whereClause)
      .groupBy(eventsTable.kafkaPartition)
      .orderBy(eventsTable.kafkaPartition);

    const instanceRows = await this.db
      .select({
        processed_by: eventsTable.processedBy,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(whereClause)
      .groupBy(eventsTable.processedBy);

    const ownershipRows = await this.db
      .select({
        kafka_partition: eventsTable.kafkaPartition,
        processed_by: eventsTable.processedBy,
        count: sql<string>`COUNT(*)::text`,
      })
      .from(eventsTable)
      .where(whereClause)
      .groupBy(eventsTable.kafkaPartition, eventsTable.processedBy)
      .orderBy(eventsTable.kafkaPartition, eventsTable.processedBy);

    const [windowTotalResult] = await this.db
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
      partition_distribution: partitionRows.map((row: { kafka_partition: number; count: string }) => ({
        kafka_partition: row.kafka_partition,
        count: Number(row.count),
      })),
      instance_distribution: instanceRows
        .map((row: { processed_by: string; count: string }) => ({
          processed_by: row.processed_by,
          count: Number(row.count),
        }))
        .sort((left, right) => right.count - left.count),
      partition_ownership: ownershipRows.map(
        (row: { kafka_partition: number; processed_by: string; count: string }) => ({
          kafka_partition: row.kafka_partition,
          processed_by: row.processed_by,
          count: Number(row.count),
        }),
      ),
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
