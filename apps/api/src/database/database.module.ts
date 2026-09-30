import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { ApiEnv } from '@runtruck/config';
import { createDatabase, type Database, type DatabaseHandle } from '@runtruck/database';
import { API_ENV } from '../config/config.module.js';

export const DATABASE_HANDLE = Symbol('DATABASE_HANDLE');
export const DB = Symbol('DB');

// idle_in_transaction_session_timeout of the API's and the worker's sessions: no transaction
// of theirs waits on anything but PostgreSQL (external calls such as S3 and Redis run
// outside transactions, docs/01 C35), so one left idle this long is a bug, and ending it
// releases its row locks and the vacuum horizon.
export const IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000;

export type { Database };

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_HANDLE,
      inject: [API_ENV],
      useFactory: (env: ApiEnv): DatabaseHandle =>
        createDatabase(env.DATABASE_URL, {
          max: env.DATABASE_POOL_MAX,
          applicationName: 'runtruck-api',
          idleInTransactionTimeoutMs: IDLE_IN_TRANSACTION_TIMEOUT_MS,
        }),
    },
    { provide: DB, inject: [DATABASE_HANDLE], useFactory: (handle: DatabaseHandle): Database => handle.db },
  ],
  exports: [DB, DATABASE_HANDLE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_HANDLE) private readonly handle: DatabaseHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
