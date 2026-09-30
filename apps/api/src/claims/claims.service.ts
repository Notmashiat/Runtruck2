import { Injectable } from '@nestjs/common';
import { toClaimRow } from '@runtruck/calculations';
import type { ClaimRow, ClaimsMeta } from '@runtruck/types';
import type { ListClaimsQuery } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { ClockService } from '../common/clock/clock.service.js';
import { pageInMemory, Q_SCAN_LIMIT, searchText } from '../common/list/list-query.js';
import { yearStart } from '../compliance/windows.js';
import { toClaimDto } from './claims.mapper.js';
import { ClaimsRepository } from './claims.repository.js';

// Safety › Settlements = claims (docs/api/safety.md §6). Two statements per request (§1.2):
// the page in SQL (or the first Q_SCAN_LIMIT rows of the filter, matched in memory over the
// shared view-model, with q) and the summary aggregate, which ignores q and status.
@Injectable()
export class ClaimsService {
  constructor(
    private readonly repository: ClaimsRepository,
    private readonly clock: ClockService,
  ) {}

  async list(ctx: AuthContext, query: ListClaimsQuery): Promise<{ data: ClaimRow[]; meta: ClaimsMeta }> {
    const org = ctx.organizationId;
    const today = this.clock.today(ctx.timezone);
    const ytdStart = yearStart(today);
    const q = searchText(query.q);

    const [rows, figures] = await Promise.all([
      this.repository.page(org, { status: query.status, ...(q ? { limit: Q_SCAN_LIMIT, offset: 0 } : { limit: query.limit, offset: query.offset }) }),
      this.repository.summary(org, { start: ytdStart, end: today }),
    ]);
    const summary = { asOf: today, ytdStart, ...figures };
    const items = rows.map(toClaimDto);

    if (q) {
      const { page, total } = pageInMemory(items, { q, limit: query.limit, offset: query.offset }, toClaimRow);
      return { data: page, meta: { total, limit: query.limit, offset: query.offset, summary } };
    }
    const total = rows[0]?.total_count ?? (query.offset > 0 ? await this.repository.count(org, query.status) : 0);
    return { data: items, meta: { total, limit: query.limit, offset: query.offset, summary } };
  }
}
