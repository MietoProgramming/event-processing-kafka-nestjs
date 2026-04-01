import {
    Global,
    Inject,
    Injectable,
    Module,
    OnApplicationShutdown,
} from '@nestjs/common';
import type { Pool } from 'pg';
import type { DrizzleDatabase } from './client';
import {
    createDatabase,
    createPgPool,
    createReadDatabases,
    createReadPgPools,
} from './client';

export const PG_POOL = Symbol('PG_POOL');
export const DRIZZLE_DB = Symbol('DRIZZLE_DB');
export const PG_READ_POOLS = Symbol('PG_READ_POOLS');
export const DRIZZLE_READ_DBS = Symbol('DRIZZLE_READ_DBS');
export const DRIZZLE_DB_READ = Symbol('DRIZZLE_DB_READ');

@Injectable()
export class ReadDatabaseRouter {
  private nextIndex = 0;

  constructor(
    @Inject(DRIZZLE_READ_DBS)
    private readonly readDatabases: DrizzleDatabase[],
  ) {}

  getDatabase(): DrizzleDatabase {
    if (this.readDatabases.length === 0) {
      throw new Error('No read databases configured');
    }

    const database = this.readDatabases[this.nextIndex % this.readDatabases.length];
    this.nextIndex = (this.nextIndex + 1) % this.readDatabases.length;
    return database;
  }
}

@Injectable()
class DatabaseShutdownService implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly writePool: Pool,
    @Inject(PG_READ_POOLS) private readonly readPools: Pool[],
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.writePool.end();
    await Promise.all(this.readPools.map((pool) => pool.end()));
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: createPgPool,
    },
    {
      provide: DRIZZLE_DB,
      inject: [PG_POOL],
      useFactory: createDatabase,
    },
    {
      provide: PG_READ_POOLS,
      useFactory: createReadPgPools,
    },
    {
      provide: DRIZZLE_READ_DBS,
      inject: [PG_READ_POOLS],
      useFactory: createReadDatabases,
    },
    ReadDatabaseRouter,
    {
      provide: DRIZZLE_DB_READ,
      useExisting: ReadDatabaseRouter,
    },
    DatabaseShutdownService,
  ],
  exports: [PG_POOL, DRIZZLE_DB, DRIZZLE_DB_READ, ReadDatabaseRouter],
})
export class DatabaseModule {}
