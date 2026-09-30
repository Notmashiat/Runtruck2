import { Controller, Get, Query } from '@nestjs/common';
import { type ListInvoicesQuery, listInvoicesQuerySchema } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { InvoicesService } from './invoices.service.js';

// Accounting › Invoiced (sent), Past Due (overdue) and Paid (paid, with payments);
// draft for completeness (docs/api/billing.md §4). There is no GET /payments (§9).
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermissions('billing.view')
  async list(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(listInvoicesQuerySchema)) query: ListInvoicesQuery) {
    const { rows, meta } = await this.invoices.list(ctx, query);
    return withMeta(rows, meta);
  }
}
