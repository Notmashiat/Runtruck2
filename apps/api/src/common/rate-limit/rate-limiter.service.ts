import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../redis/redis.module.js';

// Fixed-window counters in Redis (architecture §28 rate limiting). Shared by
// every API instance, so limits hold under horizontal scaling.
@Injectable()
export class RateLimiterService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  // Counts one hit; returns true when the key is now over `limit` in the window.
  async hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const results = await this.redis.multi().incr(key).expire(key, windowSeconds, 'NX').exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    return count > limit;
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
