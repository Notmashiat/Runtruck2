import { Inject, Injectable } from '@nestjs/common';
import { settlementViewRow } from '@runtruck/calculations';
import type { Database, DbExecutor } from '@runtruck/database';
import type { SettlementRow, SettlementsApproveMeta, SettlementsMeta } from '@runtruck/types';
import type { ApproveSettlementsInput, ListSettlementsQuery } from '@runtruck/validation';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import type { ListResult } from '../billing/billing.service.js';
import { Q_SCAN_LIMIT, searchRows, searchText } from '../common/list/list-query.js';
import { ClockService } from '../common/clock/clock.service.js';
import { AppError } from '../common/errors/app-error.js';
import { DB } from '../database/database.module.js';
import { EventsService } from '../events/events.service.js';
import { settlementApprovedAudit, settlementApprovedEvent } from './settlements.events.js';
import { SettlementsRepository } from './settlements.repository.js';
import { EMPTY_PERIOD_AGGREGATE, settlementsSummary } from './settlements.summary.js';

// The approve response always returns the whole period, as GET ?limit=500 would (§3.2).
const APPROVE_PAGE = { limit: 500, offset: 0 } as const;

// Accounting › Payroll (docs/api/settlements.md, docs/12-settlement-lifecycle.md).
@Injectable()
export class SettlementsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly repository: SettlementsRepository,
  ) {}

  // GET /settlements: the given period, or the current one (§2.1). An unknown or another
  // organization's period is an empty list, never a 404.
  async list(ctx: AuthContext, query: ListSettlementsQuery): Promise<ListResult<SettlementRow, SettlementsMeta>> {
    const periodStart = query.periodStart ?? (await this.repository.currentPeriodStart(this.db, ctx.organizationId, this.clock.today(ctx.timezone)));
    if (!periodStart) {
      return { rows: [], meta: { total: 0, limit: query.limit, offset: query.offset, summary: settlementsSummary(null, EMPTY_PERIOD_AGGREGATE) } };
    }
    return this.readPeriod(this.db, ctx.organizationId, periodStart, query);
  }

  // POST /settlements/approve (S2, 12 §5): one transaction that moves every ready settlement
  // of the period to approved, writes one audit row and one outbox event per settlement,
  // and returns the period. Idempotent: nothing ready → 200, unchanged list, nothing written.
  async approve(ctx: AuthContext, input: ApproveSettlementsInput): Promise<ListResult<SettlementRow, SettlementsApproveMeta>> {
    return this.db.transaction(async (tx) => {
      const org = ctx.organizationId;
      if (!(await this.repository.periodExists(tx, org, input.periodStart))) {
        throw AppError.notFound('SETTLEMENT_PERIOD_NOT_FOUND', 'Pay period was not found.');
      }
      // One instant (demo-pinned, D4) for approved_at, the audit rows and the events.
      const now = this.clock.now(ctx.timezone);
      const approved = await this.repository.approveReady(tx, org, { periodStart: input.periodStart, approvedAt: now, approvedByUserId: ctx.userId });
      for (const settlement of approved) {
        await this.audit.record(tx, ctx, settlementApprovedAudit(settlement, now, ctx.userId));
        await this.events.emit(tx, ctx, settlementApprovedEvent(settlement), now);
      }
      const { rows, meta } = await this.readPeriod(tx, org, input.periodStart, APPROVE_PAGE);
      return { rows, meta: { ...meta, approvedNow: approved.length } };
    });
  }

  // The period's page and summary. Sequential, so it also runs on a transaction's one connection.
  private async readPeriod(
    db: DbExecutor,
    organizationId: string,
    periodStart: string,
    query: { limit: number; offset: number; q?: string | undefined },
  ): Promise<ListResult<SettlementRow, SettlementsMeta>> {
    const q = searchText(query.q);
    const page = await this.repository.rows(db, organizationId, periodStart, q ? { limit: Q_SCAN_LIMIT, offset: 0 } : query);
    const aggregate = await this.repository.aggregate(db, organizationId, periodStart);
    const summary = settlementsSummary(periodStart, aggregate);
    const { rows, total } = q ? searchRows(page, settlementViewRow, q, query.limit, query.offset) : { rows: page, total: aggregate.driverCount };
    return { rows, meta: { total, limit: query.limit, offset: query.offset, summary } };
  }
}
