import { Injectable } from '@nestjs/common';
import { toWorkOrderRow } from '@runtruck/calculations';
import type { WorkOrderRow, WorkOrdersMeta } from '@runtruck/types';
import type { ListWorkOrdersQuery } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { ClockService } from '../common/clock/clock.service.js';
import { pageInMemory, Q_SCAN_LIMIT, searchText } from '../common/list/list-query.js';
import { doneWindowStart } from '../compliance/windows.js';
import { toWorkOrderDto } from './maintenance.mapper.js';
import { MaintenanceRepository } from './maintenance.repository.js';

// Safety › Maintenance (docs/api/safety.md §2). Two statements per request (§1.2): the page
// (status filter, order, LIMIT/OFFSET in SQL; with q the first Q_SCAN_LIMIT rows of the
// filter, matched in memory over the shared view-model) and the summary aggregate, which
// ignores q and status.
@Injectable()
export class MaintenanceService {
  constructor(
    private readonly repository: MaintenanceRepository,
    private readonly clock: ClockService,
  ) {}

  async listWorkOrders(ctx: AuthContext, query: ListWorkOrdersQuery): Promise<{ data: WorkOrderRow[]; meta: WorkOrdersMeta }> {
    const org = ctx.organizationId;
    const today = this.clock.today(ctx.timezone);
    const windowStart = doneWindowStart(today);
    const q = searchText(query.q);

    const [rows, figures] = await Promise.all([
      this.repository.page(org, { status: query.status, ...(q ? { limit: Q_SCAN_LIMIT, offset: 0 } : { limit: query.limit, offset: query.offset }) }),
      this.repository.summary(org, windowStart),
    ]);
    const summary = { asOf: today, doneWindowStart: windowStart, ...figures };
    const items = rows.map(toWorkOrderDto);

    if (q) {
      const { page, total } = pageInMemory(items, { q, limit: query.limit, offset: query.offset }, toWorkOrderRow);
      return { data: page, meta: { total, limit: query.limit, offset: query.offset, summary } };
    }
    const total = rows[0]?.total_count ?? (query.offset > 0 ? await this.repository.count(org, query.status) : 0);
    return { data: items, meta: { total, limit: query.limit, offset: query.offset, summary } };
  }
}
