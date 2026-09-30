import { Controller, Get, Query } from '@nestjs/common';
import {
  type ListInvoiceBatchesQuery,
  listInvoiceBatchesQuerySchema,
  type ListUninvoicedLoadsQuery,
  listUninvoicedLoadsQuerySchema,
} from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { BillingService } from './billing.service.js';

// Accounting › Uninvoiced (and the header's "Invoice N loads") and › Batches
// (docs/api/billing.md §3, §5). Read-only in this release (§6).
@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('billing/uninvoiced-loads')
  @RequirePermissions('billing.view')
  async uninvoicedLoads(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(listUninvoicedLoadsQuerySchema)) query: ListUninvoicedLoadsQuery) {
    const { rows, meta } = await this.billing.listUninvoicedLoads(ctx, query);
    return withMeta(rows, meta);
  }

  @Get('invoice-batches')
  @RequirePermissions('billing.view')
  async invoiceBatches(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(listInvoiceBatchesQuerySchema)) query: ListInvoiceBatchesQuery) {
    const { rows, meta } = await this.billing.listInvoiceBatches(ctx, query);
    return withMeta(rows, meta);
  }
}
