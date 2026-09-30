import { Inject, Injectable } from '@nestjs/common';
import { invoiceBatchViewRow, uninvoicedViewRow } from '@runtruck/calculations';
import type { Database } from '@runtruck/database';
import type { InvoiceBatchesMeta, InvoiceBatchRow, UninvoicedLoadRow, UninvoicedLoadsMeta } from '@runtruck/types';
import type { ListInvoiceBatchesQuery, ListUninvoicedLoadsQuery } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { ClockService } from '../common/clock/clock.service.js';
import { DB } from '../database/database.module.js';
import { BillingRepository } from './billing.repository.js';
import { Q_SCAN_LIMIT, searchRows, searchText } from '../common/list/list-query.js';
import { UninvoicedLoadsQuery } from './uninvoiced-loads.query.js';

export interface ListResult<T, M> {
  rows: T[];
  meta: M;
}

// Receivables reads (docs/api/billing.md §3, §5). Each list runs two statements, the
// page and the summary; the summary ignores q, limit and offset (billing.md §1).
@Injectable()
export class BillingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: ClockService,
    private readonly uninvoiced: UninvoicedLoadsQuery,
    private readonly repository: BillingRepository,
  ) {}

  async listUninvoicedLoads(ctx: AuthContext, query: ListUninvoicedLoadsQuery): Promise<ListResult<UninvoicedLoadRow, UninvoicedLoadsMeta>> {
    const today = this.clock.today(ctx.timezone);
    const q = searchText(query.q);
    const [page, summary] = await Promise.all([
      this.uninvoiced.rows(this.db, ctx.organizationId, q ? { limit: Q_SCAN_LIMIT, offset: 0 } : query),
      this.uninvoiced.summary(this.db, ctx.organizationId, today),
    ]);
    const { rows, total } = q ? searchRows(page, uninvoicedViewRow, q, query.limit, query.offset) : { rows: page, total: summary.loadCount };
    return { rows, meta: { total, limit: query.limit, offset: query.offset, summary } };
  }

  async listInvoiceBatches(ctx: AuthContext, query: ListInvoiceBatchesQuery): Promise<ListResult<InvoiceBatchRow, InvoiceBatchesMeta>> {
    const today = this.clock.today(ctx.timezone);
    const q = searchText(query.q);
    const [page, summary] = await Promise.all([
      this.repository.batches(this.db, ctx.organizationId, q ? { limit: Q_SCAN_LIMIT, offset: 0 } : query),
      this.repository.batchesSummary(this.db, ctx.organizationId, today),
    ]);
    const { rows, total } = q ? searchRows(page, invoiceBatchViewRow, q, query.limit, query.offset) : { rows: page, total: summary.batchCount };
    return { rows, meta: { total, limit: query.limit, offset: query.offset, summary } };
  }
}
