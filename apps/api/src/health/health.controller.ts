import { Controller, Get, Inject } from '@nestjs/common';
import type { Database } from '@runtruck/database';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { Public } from '../auth/decorators.js';
import { AppError } from '../common/errors/app-error.js';
import { DB } from '../database/database.module.js';
import { REDIS } from '../redis/redis.module.js';

// Liveness/readiness for load balancers and monitoring (architecture §35).
// Reports only up/down — never versions, hosts or error details (§29).
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  async check(): Promise<{ status: 'ok'; database: 'ok'; redis: 'ok' }> {
    try {
      await Promise.all([this.db.execute(sql`select 1`), this.redis.ping()]);
    } catch {
      throw new AppError('INTEGRATION_ERROR', 'DEPENDENCY_UNAVAILABLE', 'A required service is unavailable.');
    }
    return { status: 'ok', database: 'ok', redis: 'ok' };
  }
}
