import { Inject, Injectable } from '@nestjs/common';
import type { ClaimantKind, ClaimStatus, ClaimType } from '@runtruck/types';
import { sql } from 'drizzle-orm';
import { toNumber } from '../common/list/list-query.js';
import { type Database, DB } from '../database/database.module.js';

// Cargo and liability claims (docs/api/safety.md §6; the Safety "Settlements" tab, B12).
// Claims grow with the business: a request pages in SQL and summarizes with one aggregate
// (safety.md §1.2). Every table read and every join is scoped to the organization. Claim
// amounts and third-party claimant names are financial/personal data: never logged here.

export interface ClaimSqlRow extends Record<string, unknown> {
  id: string;
  claim_number: number;
  occurred_on: string;
  claim_type: ClaimType;
  claimant_kind: ClaimantKind;
  claimant_name: string | null;
  reserved_cents: number;
  paid_cents: number;
  status: ClaimStatus;
  driver_id: string;
  first_name: string;
  last_name: string;
  truck_id: string;
  truck_unit_number: string;
  trailer_id: string | null;
  trailer_unit_number: string | null;
  load_id: string | null;
  load_number: number | null;
  customer_id: string | null;
  customer_name: string | null;
  facility_id: string | null;
  facility_name: string | null;
  // count(*) OVER (): rows of the filter, before LIMIT/OFFSET.
  total_count: number;
}

export interface ClaimsSummaryFigures {
  claimCount: number;
  openCount: number;
  underReviewCount: number;
  openReservedCents: number;
  paidYtdCents: number;
  paidYtdCount: number;
  settledCount: number;
  deniedCount: number;
}

@Injectable()
export class ClaimsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  // One page of claims, newest number first (safety.md §6.2, §6.6). Archived loads included.
  async page(organizationId: string, p: { status?: ClaimStatus | undefined; limit: number; offset: number }): Promise<ClaimSqlRow[]> {
    const result = await this.db.execute<ClaimSqlRow>(sql`
      SELECT c.id, c.claim_number, c.occurred_on::text AS occurred_on, c.claim_type, c.claimant_kind, c.claimant_name,
             c.reserved_cents, c.paid_cents, c.status,
             d.id AS driver_id, e.first_name, e.last_name,
             t.id AS truck_id, t.unit_number AS truck_unit_number,
             tr.id AS trailer_id, tr.unit_number AS trailer_unit_number,
             l.id AS load_id, l.load_number,
             cu.id AS customer_id, cu.name AS customer_name,
             f.id AS facility_id, f.name AS facility_name,
             (count(*) OVER ())::int AS total_count
      FROM claims c
      JOIN drivers d ON d.organization_id = c.organization_id AND d.id = c.driver_id
      JOIN employees e ON e.organization_id = d.organization_id AND e.id = d.employee_id
      JOIN trucks t ON t.organization_id = c.organization_id AND t.id = c.truck_id
      LEFT JOIN trailers tr ON tr.organization_id = c.organization_id AND tr.id = c.trailer_id
      LEFT JOIN loads l ON l.organization_id = c.organization_id AND l.id = c.load_id
      LEFT JOIN customers cu ON cu.organization_id = c.organization_id AND cu.id = c.claimant_customer_id
      LEFT JOIN facilities f ON f.organization_id = c.organization_id AND f.id = c.claimant_facility_id
      WHERE c.organization_id = ${organizationId}${p.status ? sql` AND c.status = ${p.status}` : sql``}
      ORDER BY c.claim_number DESC
      LIMIT ${p.limit} OFFSET ${p.offset}`);
    return result.rows;
  }

  // Rows of the filter, for a page requested beyond its end.
  async count(organizationId: string, status: ClaimStatus | undefined): Promise<number> {
    const result = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM claims
      WHERE organization_id = ${organizationId}${status ? sql` AND status = ${status}` : sql``}`);
    return result.rows[0]?.n ?? 0;
  }

  // meta.summary in one aggregate over the organization's claims (safety.md §6.4). No claim
  // payment date is stored, so "Paid YTD" filters paid claims by the claim date (decision S5).
  async summary(organizationId: string, ytd: { start: string; end: string }): Promise<ClaimsSummaryFigures> {
    const result = await this.db.execute<{
      claim_count: number;
      open_count: number;
      under_review_count: number;
      open_reserved_cents: string;
      paid_ytd_cents: string;
      paid_ytd_count: number;
      settled_count: number;
      denied_count: number;
    }>(sql`
      SELECT count(*)::int AS claim_count,
             (count(*) FILTER (WHERE status IN ('open', 'under_review')))::int AS open_count,
             (count(*) FILTER (WHERE status = 'under_review'))::int AS under_review_count,
             coalesce(sum(reserved_cents) FILTER (WHERE status IN ('open', 'under_review')), 0)::bigint AS open_reserved_cents,
             coalesce(sum(paid_cents) FILTER (WHERE paid_cents > 0 AND occurred_on BETWEEN ${ytd.start}::date AND ${ytd.end}::date), 0)::bigint AS paid_ytd_cents,
             (count(*) FILTER (WHERE paid_cents > 0 AND occurred_on BETWEEN ${ytd.start}::date AND ${ytd.end}::date))::int AS paid_ytd_count,
             (count(*) FILTER (WHERE status = 'settled'))::int AS settled_count,
             (count(*) FILTER (WHERE status = 'denied'))::int AS denied_count
      FROM claims
      WHERE organization_id = ${organizationId}`);
    const r = result.rows[0];
    if (!r) throw new Error('Claims summary returned no row');
    return {
      claimCount: r.claim_count,
      openCount: r.open_count,
      underReviewCount: r.under_review_count,
      openReservedCents: toNumber(r.open_reserved_cents),
      paidYtdCents: toNumber(r.paid_ytd_cents),
      paidYtdCount: r.paid_ytd_count,
      settledCount: r.settled_count,
      deniedCount: r.denied_count,
    };
  }
}
