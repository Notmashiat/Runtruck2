import { Controller, Get, Query } from '@nestjs/common';
import { type DashboardQuery, dashboardQuerySchema } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { DashboardService } from './dashboard.service.js';

// The operations dashboard (docs/api/dashboard.md §2). Read-only: no audit row, no event.
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  // Takes no parameters: any query key (q, limit, …) is 400 VALIDATION_ERROR (§2.1).
  @Get()
  @RequirePermissions('dashboard.view')
  async get(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(dashboardQuerySchema)) _query: DashboardQuery) {
    const { data, meta } = await this.dashboard.get(ctx);
    return withMeta(data, meta);
  }
}
