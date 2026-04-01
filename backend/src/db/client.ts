import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type DrizzleDatabase = NodePgDatabase<typeof schema>;

const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/eventsdb';
const DEFAULT_POOL_MAX = 20;

function normalizePoolMax(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function splitConnectionStrings(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0);
}

function createPool(connectionString: string, max: number): Pool {
  return new Pool({
    connectionString,
    max,
  });
}

export function createPgPool(): Pool {
  const connectionString =
    process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const max = normalizePoolMax(process.env.PG_POOL_MAX, DEFAULT_POOL_MAX);

  return createPool(connectionString, max);
}

export function createReadPgPools(): Pool[] {
  const writeConnectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const readConnectionStrings = splitConnectionStrings(
    process.env.DATABASE_READ_URLS ?? process.env.DATABASE_READ_URL,
  );
  const effectiveConnectionStrings =
    readConnectionStrings.length > 0 ? readConnectionStrings : [writeConnectionString];
  const max = normalizePoolMax(
    process.env.PG_READ_POOL_MAX ?? process.env.PG_POOL_MAX,
    DEFAULT_POOL_MAX,
  );

  return effectiveConnectionStrings.map((connectionString) => createPool(connectionString, max));
}

export function createDatabase(pool: Pool): DrizzleDatabase {
  return drizzle(pool, { schema });
}

export function createReadDatabases(pools: Pool[]): DrizzleDatabase[] {
  return pools.map((pool) => createDatabase(pool));
}
