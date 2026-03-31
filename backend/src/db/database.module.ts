import {
    Global,
    Inject,
    Injectable,
    Module,
    OnApplicationShutdown,
} from '@nestjs/common';
import type { Pool } from 'pg';
import { createDatabase, createPgPool } from './client';

export const PG_POOL = Symbol('PG_POOL');
export const DRIZZLE_DB = Symbol('DRIZZLE_DB');

@Injectable()
class DatabaseShutdownService implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
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
    DatabaseShutdownService,
  ],
  exports: [PG_POOL, DRIZZLE_DB],
})
export class DatabaseModule {}
