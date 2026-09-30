import { Controller, Get, Query } from '@nestjs/common';
import { type ListWorkOrdersQuery, listWorkOrdersQuerySchema } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { MaintenanceService } from './maintenance.service.js';

// Safety › Maintenance (docs/api/safety.md §2). Read-only: "+ Log Service" is an inert stub
// (safety.md §8). `maintenance.view` covers unit numbers and shop names (decision S2).
@Controller('work-orders')
export class WorkOrdersController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  @RequirePermissions('maintenance.view')
  async list(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(listWorkOrdersQuerySchema)) query: ListWorkOrdersQuery) {
    const { data, meta } = await this.maintenance.listWorkOrders(ctx, query);
    return withMeta(data, meta);
  }
}
