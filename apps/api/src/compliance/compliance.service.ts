import { Injectable } from '@nestjs/common';
import { toDriverDocumentRow, toDriverWatchlistRow, toViolationRow } from '@runtruck/calculations';
import type {
  ComplianceReminderRow,
  ComplianceRemindersMeta,
  DriverDocumentRow,
  DriverDocumentsMeta,
  ViolationRow,
  ViolationsMeta,
} from '@runtruck/types';
import type { ListComplianceRemindersQuery, ListDriverDocumentsQuery, ListViolationsQuery } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { ClockService } from '../common/clock/clock.service.js';
import { pageInMemory, Q_SCAN_LIMIT, searchText } from '../common/list/list-query.js';
import { summarizeDriverDocuments, toComplianceReminderDto, toDriverDocumentDto, toViolationDto } from './compliance.mapper.js';
import { ComplianceRepository } from './compliance.repository.js';
import { expiringWindowEnd, pointsWindowStart } from './windows.js';

export interface ListResult<T, M> {
  data: T[];
  meta: M;
}

// Driver qualification files, the compliance watchlist and roadside violations
// (docs/api/safety.md §3–§5). Every summary ignores q and status (Runtruck1's search never
// changes a KPI); q is matched over the shared view-model the web searches.
@Injectable()
export class ComplianceService {
  constructor(
    private readonly repository: ComplianceRepository,
    private readonly clock: ClockService,
  ) {}

  // GET /driver-documents (safety.md §3): reference-size, evaluated in memory.
  async listDriverDocuments(ctx: AuthContext, query: ListDriverDocumentsQuery): Promise<ListResult<DriverDocumentRow, DriverDocumentsMeta>> {
    const today = this.clock.today(ctx.timezone);
    const documents = (await this.repository.driverDocuments(ctx.organizationId)).map(toDriverDocumentDto);
    const summary = summarizeDriverDocuments(documents, { asOf: today, expiringWindowEnd: expiringWindowEnd(today) });

    const filtered = query.status ? documents.filter((d) => d.status === query.status) : documents;
    const { page, total } = pageInMemory(filtered, query, toDriverDocumentRow);
    return { data: page, meta: { total, limit: query.limit, offset: query.offset, summary } };
  }

  // GET /compliance-reminders (safety.md §4): the Fleet › Drivers watchlist, in memory. The
  // search row is Fleet's WatchItem view-model (safety.md §7.3).
  async listComplianceReminders(ctx: AuthContext, query: ListComplianceRemindersQuery): Promise<ListResult<ComplianceReminderRow, ComplianceRemindersMeta>> {
    const today = this.clock.today(ctx.timezone);
    const reminders = (await this.repository.complianceReminders(ctx.organizationId)).map(toComplianceReminderDto);
    const summary = { asOf: today, reminderCount: reminders.length };
    const { page, total } = pageInMemory(reminders, query, toDriverWatchlistRow);
    return { data: page, meta: { total, limit: query.limit, offset: query.offset, summary } };
  }

  // GET /violations (safety.md §5): the page in SQL (or the first Q_SCAN_LIMIT rows of the
  // filter with q), and the summary aggregate.
  async listViolations(ctx: AuthContext, query: ListViolationsQuery): Promise<ListResult<ViolationRow, ViolationsMeta>> {
    const org = ctx.organizationId;
    const today = this.clock.today(ctx.timezone);
    const windowStart = pointsWindowStart(today);
    const q = searchText(query.q);

    const [rows, figures] = await Promise.all([
      this.repository.violationsPage(org, { status: query.status, ...(q ? { limit: Q_SCAN_LIMIT, offset: 0 } : { limit: query.limit, offset: query.offset }) }),
      this.repository.violationsSummary(org, windowStart),
    ]);
    const summary = { asOf: today, pointsWindowStart: windowStart, ...figures };
    const items = rows.map(toViolationDto);

    if (q) {
      const { page, total } = pageInMemory(items, { q, limit: query.limit, offset: query.offset }, toViolationRow);
      return { data: page, meta: { total, limit: query.limit, offset: query.offset, summary } };
    }
    const total = rows[0]?.total_count ?? (query.offset > 0 ? await this.repository.violationsCount(org, query.status) : 0);
    return { data: items, meta: { total, limit: query.limit, offset: query.offset, summary } };
  }
}
