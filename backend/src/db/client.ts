import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type DrizzleDatabase = NodePgDatabase<typeof schema>;

export function createPgPool(): Pool {
  const connectionString =
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/eventsdb';

  const max = Number(process.env.PG_POOL_MAX ?? 20);

  return new Pool({
    connectionString,
    max,
  });
}

export function createDatabase(pool: Pool): DrizzleDatabase {
  return drizzle(pool, { schema });
}
