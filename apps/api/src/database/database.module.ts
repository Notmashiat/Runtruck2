import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { ApiEnv } from '@runtruck/config';
import { createDatabase, type Database, type DatabaseHandle } from '@runtruck/database';
import { API_ENV } from '../config/config.module.js';

export const DATABASE_HANDLE = Symbol('DATABASE_HANDLE');
export const DB = Symbol('DB');

export type { Database };

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_HANDLE,
      inject: [API_ENV],
      useFactory: (env: ApiEnv): DatabaseHandle => createDatabase(env.DATABASE_URL, { max: env.DATABASE_POOL_MAX, applicationName: 'runtruck-api' }),
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
