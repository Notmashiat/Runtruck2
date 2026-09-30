import { Controller, Get, Query } from '@nestjs/common';
import { type ListBillsQuery, listBillsQuerySchema } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { PayablesService } from './payables.service.js';

// Accounting › Bills (docs/api/payables.md). Accounts payable use payables.view, not
// billing.view. Read-only in this release (§3).
@Controller('bills')
export class PayablesController {
  constructor(private readonly payables: PayablesService) {}

  @Get()
  @RequirePermissions('payables.view')
  async list(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(listBillsQuerySchema)) query: ListBillsQuery) {
    const { rows, meta } = await this.payables.listBills(ctx, query);
    return withMeta(rows, meta);
  }
}
