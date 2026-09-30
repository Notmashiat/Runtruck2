import { Controller, Get, Query } from '@nestjs/common';
import { type ListViolationsQuery, listViolationsQuerySchema } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ComplianceService } from './compliance.service.js';

// Safety › Violations (docs/api/safety.md §5). Read-only: "+ Log Violation" is an inert stub (safety.md §8).
@Controller('violations')
export class ViolationsController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get()
  @RequirePermissions('compliance.view')
  async list(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(listViolationsQuerySchema)) query: ListViolationsQuery) {
    const { data, meta } = await this.compliance.listViolations(ctx, query);
    return withMeta(data, meta);
  }
}
