import { Controller, Get, Query } from '@nestjs/common';
import { type ListComplianceRemindersQuery, listComplianceRemindersQuerySchema } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ComplianceService } from './compliance.service.js';

// The Fleet › Drivers "Compliance watchlist" and its "Docs to renew" KPI (docs/api/safety.md
// §4; decision S1: not the Dashboard). A stored record list, not derived from driver_documents.
@Controller('compliance-reminders')
export class ComplianceRemindersController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get()
  @RequirePermissions('compliance.view')
  async list(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(listComplianceRemindersQuerySchema)) query: ListComplianceRemindersQuery) {
    const { data, meta } = await this.compliance.listComplianceReminders(ctx, query);
    return withMeta(data, meta);
  }
}
