import { Controller, Get, Query } from '@nestjs/common';
import { type ListEmployeeContractsQuery, listEmployeeContractsQuerySchema } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { HrService } from './hr.service.js';

// HR › Employee Contracts (docs/api/hr.md §2). Read-only: "+ New Contract" is an inert
// stub (hr.md §5). `hr.view` also covers the contracts' pay basis (decision H1).
@Controller('hr/contracts')
export class ContractsController {
  constructor(private readonly hr: HrService) {}

  @Get()
  @RequirePermissions('hr.view')
  async list(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(listEmployeeContractsQuerySchema)) query: ListEmployeeContractsQuery) {
    const { data, meta } = await this.hr.listContracts(ctx, query);
    return withMeta(data, meta);
  }
}
