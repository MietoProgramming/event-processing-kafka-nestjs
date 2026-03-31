import { integer, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const eventsTable = pgTable('events', {
  id: uuid('id').notNull(),
  userId: varchar('user_id', { length: 128 }).notNull(),
  eventType: varchar('event_type', { length: 128 }).notNull(),
  processedBy: varchar('processed_by', { length: 64 }).notNull(),
  kafkaPartition: integer('kafka_partition').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: false }).notNull(),
});

export type EventInsert = typeof eventsTable.$inferInsert;
export type EventRecord = typeof eventsTable.$inferSelect;
