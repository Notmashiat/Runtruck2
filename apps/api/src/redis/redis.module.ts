import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { ApiEnv } from '@runtruck/config';
import { Redis } from 'ioredis';
import { API_ENV } from '../config/config.module.js';

export const REDIS = Symbol('REDIS');

// Redis backs job queues and rate limiting (architecture §24, §28). It never
// holds authoritative business data.
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [API_ENV],
      // maxRetriesPerRequest: null is required by BullMQ for blocking connections.
      useFactory: (env: ApiEnv): Redis => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
