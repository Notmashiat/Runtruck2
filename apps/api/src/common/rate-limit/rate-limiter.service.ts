import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../redis/redis.module.js';

const RELEASE_SCRIPT = `
local n = tonumber(redis.call('GET', KEYS[1]) or '0')
if n > 0 then return redis.call('DECR', KEYS[1]) end
return 0`;

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

  // Takes back one hit (never below zero, never creating the key), for attempts that turn
  // out not to count, e.g. a successful sign-in against the per-IP budget.
  async release(key: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, key);
  }
}
