import { Inject, Injectable } from '@nestjs/common';
import { billViewRow } from '@runtruck/calculations';
import type { Database } from '@runtruck/database';
import type { BillRow, BillsMeta } from '@runtruck/types';
import type { ListBillsQuery } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import type { ListResult } from '../billing/billing.service.js';
import { monthRange } from '../billing/list-query.js';
import { Q_SCAN_LIMIT, searchRows, searchText } from '../common/list/list-query.js';
import { ClockService } from '../common/clock/clock.service.js';
import { DB } from '../database/database.module.js';
import { PayablesRepository } from './payables.repository.js';

// GET /bills (docs/api/payables.md §2): every bill and the four KPI figures.
@Injectable()
export class PayablesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: ClockService,
    private readonly repository: PayablesRepository,
  ) {}

  async listBills(ctx: AuthContext, query: ListBillsQuery): Promise<ListResult<BillRow, BillsMeta>> {
    const today = this.clock.today(ctx.timezone);
    const q = searchText(query.q);
    const [page, { rowCount, summary }] = await Promise.all([
      this.repository.bills(this.db, ctx.organizationId, q ? { limit: Q_SCAN_LIMIT, offset: 0 } : query),
      this.repository.summary(this.db, ctx.organizationId, { today, month: monthRange(today) }),
    ]);
    const { rows, total } = q ? searchRows(page, billViewRow, q, query.limit, query.offset) : { rows: page, total: rowCount };
    return { rows, meta: { total, limit: query.limit, offset: query.offset, summary } };
  }
}
