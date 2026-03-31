import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { KafkaContext } from '@nestjs/microservices';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { DrizzleDatabase } from './db/client';
import { DRIZZLE_DB } from './db/database.module';
import { eventsTable, type EventInsert } from './db/schema';

export type KafkaPayloadValue = {
  key?: Buffer | string | null;
  value?: Buffer | string | Record<string, unknown> | null;
};

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private readonly instanceId = process.env.INSTANCE_ID ?? 'backend';
  private readonly batchSize = Number(process.env.BATCH_SIZE ?? 500);
  private readonly flushIntervalMs = Number(process.env.FLUSH_INTERVAL_MS ?? 500);

  private readonly buffer: EventInsert[] = [];
  private localConsumedCount = 0;

  private flushTimer?: NodeJS.Timeout;
  private flushing = false;
  private flushRequested = false;

  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDatabase) {}

  async onModuleInit(): Promise<void> {
    await this.ensureEventsAnalyticsColumns();

    this.flushTimer = setInterval(() => {
      void this.flushBufferedEvents();
    }, this.flushIntervalMs);

    this.logger.log(
      `Initialized instance=${this.instanceId} batchSize=${this.batchSize} flushIntervalMs=${this.flushIntervalMs}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }

    await this.flushBufferedEvents(true);
  }

  getLocalConsumedCount(): number {
    return this.localConsumedCount;
  }

  async consumeEvent(payload: KafkaPayloadValue, context: KafkaContext): Promise<void> {
    const parsed = this.parseIncomingEvent(payload, context.getPartition());

    if (!parsed) {
      return;
    }

    this.buffer.push(parsed);
    this.localConsumedCount += 1;

    if (this.localConsumedCount % 5000 === 0) {
      this.logger.log(
        `instance=${this.instanceId} consumed=${this.localConsumedCount} partition=${context.getPartition()}`,
      );
    }

    if (this.buffer.length >= this.batchSize) {
      await this.flushBufferedEvents();
    }
  }

  private async ensureEventsAnalyticsColumns(): Promise<void> {
    await this.db.execute(
      sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS processed_by VARCHAR(64) NOT NULL DEFAULT 'unknown'`,
    );
    await this.db.execute(
      sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS kafka_partition INTEGER NOT NULL DEFAULT -1`,
    );
    await this.db.execute(sql`ALTER TABLE events ALTER COLUMN processed_by DROP DEFAULT`);
    await this.db.execute(sql`ALTER TABLE events ALTER COLUMN kafka_partition DROP DEFAULT`);
    await this.db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_events_processed_by_created_at ON events (processed_by, created_at DESC)`,
    );
    await this.db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_events_partition_created_at ON events (kafka_partition, created_at DESC)`,
    );
  }

  private parseIncomingEvent(payload: KafkaPayloadValue, kafkaPartition: number): EventInsert | null {
    const rawValue = payload.value;

    if (!rawValue) {
      return null;
    }

    try {
      const event: Record<string, unknown> =
        typeof rawValue === 'string'
          ? (JSON.parse(rawValue) as Record<string, unknown>)
          : Buffer.isBuffer(rawValue)
            ? (JSON.parse(rawValue.toString('utf8')) as Record<string, unknown>)
            : rawValue;
      const createdAtRaw = event.created_at;
      const createdAtCandidate =
        typeof createdAtRaw === 'string' ? new Date(createdAtRaw) : new Date();
      const createdAt = Number.isNaN(createdAtCandidate.getTime()) ? new Date() : createdAtCandidate;

      return {
        id: typeof event.id === 'string' ? event.id : randomUUID(),
        userId: typeof event.user_id === 'string' ? event.user_id : 'unknown',
        eventType: typeof event.event_type === 'string' ? event.event_type : 'unknown',
        processedBy: this.instanceId,
        kafkaPartition,
        payload:
          typeof event.payload === 'object' && event.payload !== null
            ? (event.payload as Record<string, unknown>)
            : {},
        createdAt,
      };
    } catch (error) {
      this.logger.warn(`Failed to parse Kafka event payload: ${(error as Error).message}`);
      return null;
    }
  }

  private async flushBufferedEvents(force = false): Promise<void> {
    if (this.flushing) {
      this.flushRequested = true;
      return;
    }

    if (!force && this.buffer.length === 0) {
      return;
    }

    this.flushing = true;

    try {
      while (this.buffer.length > 0) {
        const batch = this.buffer.splice(0, this.batchSize);

        for (let index = 0; index < batch.length; index += 250) {
          const chunk = batch.slice(index, index + 250);
          await this.db.insert(eventsTable).values(chunk);
        }
      }
    } catch (error) {
      this.logger.error(`Batch insert failed: ${(error as Error).message}`);
    } finally {
      this.flushing = false;

      if (this.flushRequested) {
        this.flushRequested = false;

        if (this.buffer.length > 0) {
          void this.flushBufferedEvents(true);
        }
      }
    }
  }
}
