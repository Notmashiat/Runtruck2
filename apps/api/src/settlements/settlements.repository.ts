import { Injectable } from '@nestjs/common';
import { formatPayBasis } from '@runtruck/calculations';
import type { DbExecutor } from '@runtruck/database';
import type { SettlementPayBasis, SettlementRow, SettlementStatus } from '@runtruck/types';
import { type SQL, sql } from 'drizzle-orm';
import { toNumber } from '../common/list/list-query.js';
import { APPROVABLE_STATUS } from './settlement-state.js';
import type { ApprovedSettlement } from './settlements.events.js';

// Driver settlements of one pay period with their item totals (docs/api/settlements.md §2).
// Nothing is stored as a total (03 §1.8). Settlements, items, drivers and employees all
// carry the organization predicate.

function periodRelation(organizationId: string, periodStart: string): SQL {
  return sql`SELECT s.id, s.driver_id, e.first_name || ' ' || e.last_name AS driver_name, d.position,
         s.period_start, s.period_end, s.pay_basis, s.pay_rate_cents, s.pay_percent_bp,
         s.status, s.hold_reason, s.approved_at,
         (count(si.id) FILTER (WHERE si.kind = 'line_pay'))::int AS load_count,
         coalesce(sum(si.miles) FILTER (WHERE si.kind = 'line_pay'), 0)::bigint AS miles,
         coalesce(sum(si.amount_cents) FILTER (WHERE si.kind = 'line_pay'), 0)::bigint AS gross_cents,
         coalesce(sum(si.amount_cents) FILTER (WHERE si.kind = 'deduction'), 0)::bigint AS deductions_cents
  FROM settlements s
  JOIN drivers d ON d.organization_id = s.organization_id AND d.id = s.driver_id
  JOIN employees e ON e.organization_id = d.organization_id AND e.id = d.employee_id
  LEFT JOIN settlement_items si ON si.organization_id = s.organization_id AND si.settlement_id = s.id
  WHERE s.organization_id = ${organizationId} AND s.period_start = ${periodStart}::date
  GROUP BY s.id, d.position, e.first_name, e.last_name`;
}

interface SettlementDbRow extends Record<string, unknown> {
  id: string;
  driver_id: string;
  driver_name: string;
  period_start: string;
  period_end: string;
  pay_basis: SettlementPayBasis;
  pay_rate_cents: number | null;
  pay_percent_bp: number | null;
  status: SettlementStatus;
  hold_reason: string | null;
  approved_at: string | null;
  load_count: number;
  miles: string;
  gross_cents: string;
  deductions_cents: string;
}

export interface PeriodAggregate {
  driverCount: number;
  readyCount: number;
  approvedCount: number;
  onHoldCount: number;
  paidCount: number;
  grossCents: number;
  deductionsCents: number;
  periodEnd: string | null;
}

function toSettlementRow(r: SettlementDbRow): SettlementRow {
  const grossCents = toNumber(r.gross_cents);
  const deductionsCents = toNumber(r.deductions_cents);
  return {
    id: r.id,
    driverId: r.driver_id,
    driverName: r.driver_name,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    payBasis: r.pay_basis,
    payRateCents: r.pay_rate_cents,
    payPercentBp: r.pay_percent_bp,
    // The same function HR › Contracts uses (03 §6.0.6), so both read identically.
    payBasisLabel: formatPayBasis(r.pay_basis, r.pay_rate_cents, r.pay_percent_bp),
    loadCount: r.load_count,
    miles: toNumber(r.miles),
    grossCents,
    deductionsCents,
    netCents: grossCents + deductionsCents,
    status: r.status,
    holdReason: r.hold_reason,
    approvedAt: r.approved_at,
  };
}

@Injectable()
export class SettlementsRepository {
  // The period containing today, else the latest one that started on or before today
  // (03 §6.7.6); null when the organization has none.
  async currentPeriodStart(db: DbExecutor, organizationId: string, today: string): Promise<string | null> {
    const result = await db.execute<{ period_start: string }>(sql`SELECT period_start::text AS period_start FROM settlements
      WHERE organization_id = ${organizationId} AND period_start <= ${today}::date
      ORDER BY (period_end >= ${today}::date) DESC, period_start DESC
      LIMIT 1`);
    return result.rows[0]?.period_start ?? null;
  }

  // The period's settlements in list order (drivers.position, id; = Runtruck1's order).
  async rows(db: DbExecutor, organizationId: string, periodStart: string, page: { limit: number; offset: number }): Promise<SettlementRow[]> {
    const result = await db.execute<SettlementDbRow>(sql`SELECT p.id, p.driver_id, p.driver_name, p.period_start::text AS period_start,
             p.period_end::text AS period_end, p.pay_basis, p.pay_rate_cents, p.pay_percent_bp, p.status, p.hold_reason,
             to_char(p.approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS approved_at,
             p.load_count, p.miles, p.gross_cents, p.deductions_cents
      FROM (${periodRelation(organizationId, periodStart)}) p
      ORDER BY p.position ASC, p.id ASC
      LIMIT ${page.limit} OFFSET ${page.offset}`);
    return result.rows.map(toSettlementRow);
  }

  // Counts and money over every settlement of the period, any status (settlements.md §2.3).
  async aggregate(db: DbExecutor, organizationId: string, periodStart: string): Promise<PeriodAggregate> {
    const result = await db.execute<{
      driver_count: number;
      ready_count: number;
      approved_count: number;
      on_hold_count: number;
      paid_count: number;
      gross_cents: string;
      deductions_cents: string;
      period_end: string | null;
    }>(sql`SELECT count(*)::int AS driver_count,
             (count(*) FILTER (WHERE p.status = 'ready'))::int AS ready_count,
             (count(*) FILTER (WHERE p.status = 'approved'))::int AS approved_count,
             (count(*) FILTER (WHERE p.status = 'on_hold'))::int AS on_hold_count,
             (count(*) FILTER (WHERE p.status = 'paid'))::int AS paid_count,
             coalesce(sum(p.gross_cents), 0)::bigint AS gross_cents,
             coalesce(sum(p.deductions_cents), 0)::bigint AS deductions_cents,
             max(p.period_end)::text AS period_end
      FROM (${periodRelation(organizationId, periodStart)}) p`);
    const r = result.rows[0];
    if (!r) throw new Error('Settlements summary returned no row');
    return {
      driverCount: r.driver_count,
      readyCount: r.ready_count,
      approvedCount: r.approved_count,
      onHoldCount: r.on_hold_count,
      paidCount: r.paid_count,
      grossCents: toNumber(r.gross_cents),
      deductionsCents: toNumber(r.deductions_cents),
      periodEnd: r.period_end,
    };
  }

  async periodExists(db: DbExecutor, organizationId: string, periodStart: string): Promise<boolean> {
    const result = await db.execute(sql`SELECT 1 FROM settlements
      WHERE organization_id = ${organizationId} AND period_start = ${periodStart}::date LIMIT 1`);
    return result.rows.length > 0;
  }

  // S2: every ready settlement of the period → approved (12 §5); returns the moved rows
  // with their driver names, in list order. Under READ COMMITTED a concurrent call blocks
  // on the row locks, re-checks status = 'ready' after the first commits and updates
  // nothing, so no settlement is approved, audited or announced twice.
  async approveReady(
    db: DbExecutor,
    organizationId: string,
    args: { periodStart: string; approvedAt: Date; approvedByUserId: string },
  ): Promise<ApprovedSettlement[]> {
    const result = await db.execute<{ id: string; driver_id: string; driver_name: string; period_start: string }>(sql`WITH moved AS (
        UPDATE settlements
           SET status = 'approved', approved_at = ${args.approvedAt.toISOString()}::timestamptz,
               approved_by_user_id = ${args.approvedByUserId}, updated_at = now()
         WHERE organization_id = ${organizationId} AND period_start = ${args.periodStart}::date AND status = ${APPROVABLE_STATUS}
        RETURNING id, driver_id, period_start
      )
      SELECT m.id, m.driver_id, e.first_name || ' ' || e.last_name AS driver_name, m.period_start::text AS period_start
      FROM moved m
      JOIN drivers d ON d.organization_id = ${organizationId} AND d.id = m.driver_id
      JOIN employees e ON e.organization_id = d.organization_id AND e.id = d.employee_id
      ORDER BY d.position ASC, m.id ASC`);
    return result.rows.map((r) => ({ id: r.id, driverId: r.driver_id, driverName: r.driver_name, periodStart: r.period_start }));
  }
}
