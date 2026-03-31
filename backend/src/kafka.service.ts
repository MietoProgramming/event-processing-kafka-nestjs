import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { DrizzleDatabase } from './db/client';
import { DRIZZLE_DB } from './db/database.module';
import { eventsTable, type EventInsert } from './db/schema';

const TOPIC_EVENT_TYPE_MAP = {
  'events.page_views': {
    eventType: 'page_view',
    keyField: 'session_id',
  },
  'events.clicks': {
    eventType: 'click',
    keyField: 'user_id',
  },
  'events.purchases': {
    eventType: 'purchase',
    keyField: 'order_id',
  },
} as const;

type SupportedTopic = keyof typeof TOPIC_EVENT_TYPE_MAP;

export type KafkaPayloadValue = {
  topic: string;
  partition: number;
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

  async consumeEvent(payload: KafkaPayloadValue): Promise<void> {
    const parsed = this.parseIncomingEvent(payload);

    if (!parsed) {
      return;
    }

    this.buffer.push(parsed);
    this.localConsumedCount += 1;

    if (this.localConsumedCount % 5000 === 0) {
      this.logger.log(
        `instance=${this.instanceId} consumed=${this.localConsumedCount} topic=${payload.topic} partition=${payload.partition}`,
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
    await this.db.execute(
      sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS kafka_topic VARCHAR(128) NOT NULL DEFAULT 'unknown_topic'`,
    );
    await this.db.execute(sql`ALTER TABLE events ALTER COLUMN processed_by DROP DEFAULT`);
    await this.db.execute(sql`ALTER TABLE events ALTER COLUMN kafka_partition DROP DEFAULT`);
    await this.db.execute(sql`ALTER TABLE events ALTER COLUMN kafka_topic DROP DEFAULT`);
    await this.db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_events_processed_by_created_at ON events (processed_by, created_at DESC)`,
    );
    await this.db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_events_partition_created_at ON events (kafka_partition, created_at DESC)`,
    );
    await this.db.execute(
      sql`CREATE INDEX IF NOT EXISTS idx_events_topic_created_at ON events (kafka_topic, created_at DESC)`,
    );
  }

  private parseIncomingEvent(payload: KafkaPayloadValue): EventInsert | null {
    if (!this.isSupportedTopic(payload.topic)) {
      this.logger.warn(`Skipping message from unsupported topic=${payload.topic}`);
      return null;
    }

    const topicConfig = TOPIC_EVENT_TYPE_MAP[payload.topic];
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
      const payloadObject =
        typeof event.payload === 'object' && event.payload !== null
          ? { ...(event.payload as Record<string, unknown>) }
          : {};
      const messageKey = this.stringifyKafkaKey(payload.key);

      if (messageKey && typeof payloadObject[topicConfig.keyField] !== 'string') {
        payloadObject[topicConfig.keyField] = messageKey;
      }

      const incomingEventType = typeof event.event_type === 'string' ? event.event_type : null;
      if (incomingEventType && incomingEventType !== topicConfig.eventType) {
        this.logger.warn(
          `event_type mismatch for topic=${payload.topic}; expected=${topicConfig.eventType} received=${incomingEventType}; using expected value`,
        );
      }

      const resolvedUserId =
        typeof event.user_id === 'string'
          ? event.user_id
          : payload.topic === 'events.clicks' && messageKey
            ? messageKey
            : 'unknown';

      return {
        id: typeof event.id === 'string' ? event.id : randomUUID(),
        userId: resolvedUserId,
        eventType: topicConfig.eventType,
        processedBy: this.instanceId,
        kafkaPartition: payload.partition,
        kafkaTopic: payload.topic,
        payload: payloadObject,
        createdAt,
      };
    } catch (error) {
      this.logger.warn(`Failed to parse Kafka event payload: ${(error as Error).message}`);
      return null;
    }
  }

  private isSupportedTopic(topic: string): topic is SupportedTopic {
    return Object.prototype.hasOwnProperty.call(TOPIC_EVENT_TYPE_MAP, topic);
  }

  private stringifyKafkaKey(key: Buffer | string | null | undefined): string | null {
    if (typeof key === 'string') {
      return key;
    }

    if (Buffer.isBuffer(key)) {
      return key.toString('utf8');
    }

    return null;
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
