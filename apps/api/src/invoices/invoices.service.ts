import { Inject, Injectable } from '@nestjs/common';
import { invoiceViewRow, paidInvoiceViewRow } from '@runtruck/calculations';
import type { Database } from '@runtruck/database';
import type { InvoiceListMeta, InvoiceListSummary, InvoiceRow, InvoiceStatus } from '@runtruck/types';
import type { ListInvoicesQuery } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import type { ListResult } from '../billing/billing.service.js';
import { monthRange } from '../billing/list-query.js';
import { Q_SCAN_LIMIT, searchRows, searchText } from '../common/list/list-query.js';
import { ClockService } from '../common/clock/clock.service.js';
import { DB } from '../database/database.module.js';
import { InvoicesRepository } from './invoices.repository.js';
import { draftSummary, overdueSummary, paidSummary } from './invoices.summary.js';

// GET /invoices?status=… (docs/api/billing.md §4): the rows of one status and the
// summary that status's screen shows. Two statements: page and summary.
@Injectable()
export class InvoicesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: ClockService,
    private readonly repository: InvoicesRepository,
  ) {}

  async list(ctx: AuthContext, query: ListInvoicesQuery): Promise<ListResult<InvoiceRow, InvoiceListMeta>> {
    const today = this.clock.today(ctx.timezone);
    const q = searchText(query.q);
    const [page, { summary, rowCount }] = await Promise.all([
      this.repository.rows(this.db, ctx.organizationId, {
        status: query.status,
        today,
        timezone: ctx.timezone,
        ...(q ? { limit: Q_SCAN_LIMIT, offset: 0 } : { limit: query.limit, offset: query.offset }),
      }),
      this.summary(ctx, query.status, today),
    ]);
    // Paid rows search Runtruck1's {...invoice, paid, via, days}; the others its Invoice row.
    const toView = query.status === 'paid' ? paidInvoiceViewRow : invoiceViewRow;
    const { rows, total } = q ? searchRows(page, toView, q, query.limit, query.offset) : { rows: page, total: rowCount };
    return { rows, meta: { total, limit: query.limit, offset: query.offset, summary } };
  }

  // The status's summary and the number of rows of the status (meta.total without q).
  private async summary(ctx: AuthContext, status: InvoiceStatus, today: string): Promise<{ summary: InvoiceListSummary; rowCount: number }> {
    const org = ctx.organizationId;
    switch (status) {
      case 'sent': {
        const { rowCount, arAging } = await this.repository.arAging(this.db, org, today);
        return { rowCount, summary: { status: 'sent', arAging } };
      }
      case 'overdue': {
        const agg = await this.repository.overdueAggregate(this.db, org, today);
        return { rowCount: agg.rowCount, summary: overdueSummary(agg) };
      }
      case 'paid': {
        const month = monthRange(today);
        const agg = await this.repository.paidAggregate(this.db, org, { timezone: ctx.timezone, month });
        return { rowCount: agg.rowCount, summary: paidSummary(agg, month.start) };
      }
      case 'draft': {
        const agg = await this.repository.draftAggregate(this.db, org);
        return { rowCount: agg.rowCount, summary: draftSummary(agg) };
      }
    }
  }
}
