import { Inject, Injectable } from '@nestjs/common';
import { desc, sql } from 'drizzle-orm';
import type { DrizzleDatabase } from './db/client';
import { DRIZZLE_DB } from './db/database.module';
import { eventsTable } from './db/schema';
import { KafkaService } from './kafka.service';

export type LatestEventRow = {
  id: string;
  user_id: string;
  event_type: string;
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

@Injectable()
export class StatsService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDatabase,
    private readonly kafkaService: KafkaService,
  ) {}

  async getLatestEvents(limit = 100): Promise<LatestEventRow[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);

    const rows = await this.db
      .select({
        id: eventsTable.id,
        user_id: eventsTable.userId,
        event_type: eventsTable.eventType,
        payload: eventsTable.payload,
        created_at: eventsTable.createdAt,
      })
      .from(eventsTable)
      .orderBy(desc(eventsTable.createdAt))
      .limit(safeLimit);

    return rows.map((row: {
      id: string;
      user_id: string;
      event_type: string;
      payload: Record<string, unknown> | null;
      created_at: Date;
    }) => ({
      id: row.id,
      user_id: row.user_id,
      event_type: row.event_type,
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
}
