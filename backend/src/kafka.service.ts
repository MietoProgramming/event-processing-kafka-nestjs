import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
    Ctx,
    EventPattern,
    KafkaContext,
    Payload,
} from '@nestjs/microservices';
import { randomUUID } from 'node:crypto';
import type { DrizzleDatabase } from './db/client';
import { DRIZZLE_DB } from './db/database.module';
import { eventsTable, type EventInsert } from './db/schema';

type KafkaPayloadValue = {
  key?: Buffer | string | null;
  value?: Buffer | string | null;
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

  onModuleInit(): void {
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

  @EventPattern('events.page_views')
  async consumeEvent(
    @Payload() payload: KafkaPayloadValue,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    const parsed = this.parseIncomingEvent(payload);

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

  private parseIncomingEvent(payload: KafkaPayloadValue): EventInsert | null {
    const rawValue = payload.value;

    if (!rawValue) {
      return null;
    }

    const serialized = Buffer.isBuffer(rawValue) ? rawValue.toString('utf8') : rawValue;

    try {
      const event = JSON.parse(serialized) as Record<string, unknown>;
      const createdAtRaw = event.created_at;
      const createdAtCandidate =
        typeof createdAtRaw === 'string' ? new Date(createdAtRaw) : new Date();
      const createdAt = Number.isNaN(createdAtCandidate.getTime()) ? new Date() : createdAtCandidate;

      return {
        id: typeof event.id === 'string' ? event.id : randomUUID(),
        userId: typeof event.user_id === 'string' ? event.user_id : 'unknown',
        eventType: typeof event.event_type === 'string' ? event.event_type : 'unknown',
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
