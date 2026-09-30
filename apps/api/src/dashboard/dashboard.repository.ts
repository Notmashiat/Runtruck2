import { Injectable } from '@nestjs/common';
import { type DbExecutor, schema } from '@runtruck/database';
import type { DashboardActiveLoadStatus, DashboardDriverDutyStatus } from '@runtruck/types';
import { and, asc, eq, sql } from 'drizzle-orm';
import { uninvoicedLoadPredicate } from '../billing/uninvoiced-loads.query.js';
import { loadEndpoints } from '../loads/load-endpoints.js';
import type { DeadheadWeekTotals, RevenueDayTotal } from './dashboard.figures.js';

// The set-based reads of GET /dashboard (docs/api/dashboard.md §2.7). Every method takes
// the session's organization id and every relation (joins, laterals, candidate
// sub-queries) carries it. Stops are looked up per load through LATERAL (… LIMIT 1) on
// load_stops_load_sequence_uq, and only for candidate loads found through a date index,
// so no statement reads the organization's whole history (architecture §37, §38).

const { drivers, employees } = schema;

// Runtruck1 ACTIVE_STATUSES / delivered statuses (03 §6.0.3), inlined as SQL literals.
const ACTIVE = sql.raw(`('needs_driver', 'dispatched', 'at_pickup', 'in_transit', 'delayed')`);
const DELIVERED = sql.raw(`('needs_pod', 'delivered')`);

// revenue(l), cast before adding so neither a row nor a sum can overflow int4 (03 §6.0.3).
const REVENUE = sql.raw(`l.line_haul_cents::bigint + l.fuel_surcharge_cents + l.accessorial_cents`);

// First pickup (else the first stop) and last delivery (else the last stop) of load `l`.
const FIRST_PICKUP = sql.raw(`LEFT JOIN LATERAL (
    SELECT s.appointment_date FROM load_stops s
    WHERE s.organization_id = l.organization_id AND s.load_id = l.id
    ORDER BY (s.kind <> 'pickup'), s.sequence LIMIT 1) fp ON true`);
const LAST_DELIVERY = sql.raw(`LEFT JOIN LATERAL (
    SELECT s.appointment_date, s.completed_at, s.timezone FROM load_stops s
    WHERE s.organization_id = l.organization_id AND s.load_id = l.id
    ORDER BY (s.kind <> 'delivery'), s.sequence DESC LIMIT 1) ld ON true`);

// Candidate loads: those with a stop dated in [from, to] (load_stops_org_date_idx).
function loadsWithStopDated(organizationId: string, from: string, to: string | null) {
  return to === null
    ? sql`SELECT s.load_id FROM load_stops s WHERE s.organization_id = ${organizationId} AND s.appointment_date >= ${from}::date`
    : sql`SELECT s.load_id FROM load_stops s WHERE s.organization_id = ${organizationId} AND s.appointment_date BETWEEN ${from}::date AND ${to}::date`;
}

export interface ActiveLoadRecord {
  id: string;
  loadNumber: number;
  customerName: string;
  route: string | null;
  lineHaulCents: number;
  status: DashboardActiveLoadStatus;
}

export interface DashboardDriverRecord {
  id: string;
  firstName: string;
  lastName: string;
  dutyStatus: DashboardDriverDutyStatus;
  hosRemainingMinutes: number | null;
}

interface ActiveDbRow extends Record<string, unknown> {
  id: string;
  load_number: number;
  line_haul_cents: number;
  status: DashboardActiveLoadStatus;
  customer_name: string;
  active_count: number;
}

interface CountDbRow extends Record<string, unknown> {
  n: number;
}

interface RevenueDbRow extends Record<string, unknown> {
  day: string;
  revenue_cents: string;
}

interface DeadheadDbRow extends Record<string, unknown> {
  this_week: boolean;
  empty_miles: string;
  total_miles: string;
}

interface UnbilledDbRow extends Record<string, unknown> {
  load_count: number;
  amount_cents: string;
}

@Injectable()
export class DashboardRepository {
  // Query 1: the first 6 active board loads in board order, with the count of all of them
  // (count(*) OVER () runs before LIMIT). Routes come from the loads module's shared
  // helper for those ≤ 6 loads, so they are byte-identical to GET /loads `route`.
  async activeLoads(db: DbExecutor, organizationId: string, limit: number): Promise<{ rows: ActiveLoadRecord[]; count: number }> {
    const result =
      await db.execute<ActiveDbRow>(sql`SELECT a.id, a.load_number, a.line_haul_cents, a.status, c.name AS customer_name, a.active_count
      FROM (
        SELECT l.id, l.organization_id, l.customer_id, l.load_number, l.line_haul_cents, l.status, l.created_at,
               (count(*) OVER ())::int AS active_count
        FROM loads l
        WHERE l.organization_id = ${organizationId} AND l.archived_at IS NULL AND l.status IN ${ACTIVE}
        ORDER BY l.created_at DESC, l.load_number DESC
        LIMIT ${limit}) a
      JOIN customers c ON c.organization_id = a.organization_id AND c.id = a.customer_id
      ORDER BY a.created_at DESC, a.load_number DESC`);
    const endpoints = await loadEndpoints(
      db,
      organizationId,
      result.rows.map((r) => r.id),
    );
    return {
      count: result.rows[0]?.active_count ?? 0,
      rows: result.rows.map((r) => ({
        id: r.id,
        loadNumber: r.load_number,
        customerName: r.customer_name,
        route: endpoints.get(r.id)?.route ?? null,
        lineHaulCents: r.line_haul_cents,
        status: r.status,
      })),
    };
  }

  // Query 2: activeOn(day) — loads (board or archived, any status) whose first pickup
  // date ≤ day ≤ last delivery date. Candidates have a stop dated ≥ day, which is exact
  // because the last delivery itself is such a stop.
  async activeOnCount(db: DbExecutor, organizationId: string, day: string): Promise<number> {
    const result = await db.execute<CountDbRow>(sql`SELECT count(*)::int AS n
      FROM loads l
      ${FIRST_PICKUP}
      ${LAST_DELIVERY}
      WHERE l.organization_id = ${organizationId}
        AND l.id IN (${loadsWithStopDated(organizationId, day, null)})
        AND fp.appointment_date <= ${day}::date AND ld.appointment_date >= ${day}::date`);
    return result.rows[0]?.n ?? 0;
  }

  // Query 3: Σ revenue(l) per delivered_on day in [from, to], over loads in a delivered
  // status. delivered_on is the last delivery's completion date in its own timezone, else
  // its appointment date; the candidates are loads with a stop dated in the range, or
  // completed within a day of it read as UTC instants (every offset lies within a day).
  async revenueByDeliveryDay(db: DbExecutor, organizationId: string, from: string, to: string): Promise<RevenueDayTotal[]> {
    const result = await db.execute<RevenueDbRow>(sql`SELECT r.day::text AS day, sum(r.revenue)::bigint::text AS revenue_cents
      FROM (
        SELECT coalesce((ld.completed_at AT TIME ZONE ld.timezone)::date, ld.appointment_date) AS day, ${REVENUE} AS revenue
        FROM loads l
        ${LAST_DELIVERY}
        WHERE l.organization_id = ${organizationId}
          AND l.status IN ${DELIVERED}
          AND l.id IN (
            ${loadsWithStopDated(organizationId, from, to)}
            UNION
            SELECT s.load_id FROM load_stops s
            WHERE s.organization_id = ${organizationId}
              AND s.completed_at >= ((${from}::date - 1)::timestamp AT TIME ZONE 'UTC')
              AND s.completed_at < ((${to}::date + 2)::timestamp AT TIME ZONE 'UTC'))
      ) r
      WHERE r.day BETWEEN ${from}::date AND ${to}::date
      GROUP BY r.day
      ORDER BY r.day`);
    return result.rows.map((r) => ({ day: r.day, revenueCents: BigInt(r.revenue_cents) }));
  }

  // Query 4: Σ empty_miles and Σ (loaded + empty) of loads with both mile columns set whose
  // first pickup falls in the previous org week or the org week, split at weekStart.
  async deadheadMiles(
    db: DbExecutor,
    organizationId: string,
    weeks: { previousWeekStart: string; weekStart: string; weekEnd: string },
  ): Promise<{ thisWeek: DeadheadWeekTotals | null; previousWeek: DeadheadWeekTotals | null }> {
    const { previousWeekStart, weekStart, weekEnd } = weeks;
    const result = await db.execute<DeadheadDbRow>(sql`SELECT (fp.appointment_date >= ${weekStart}::date) AS this_week,
             sum(l.empty_miles)::bigint::text AS empty_miles,
             sum(l.loaded_miles::bigint + l.empty_miles)::bigint::text AS total_miles
      FROM loads l
      ${FIRST_PICKUP}
      WHERE l.organization_id = ${organizationId}
        AND l.loaded_miles IS NOT NULL AND l.empty_miles IS NOT NULL
        AND l.id IN (${loadsWithStopDated(organizationId, previousWeekStart, weekEnd)})
        AND fp.appointment_date BETWEEN ${previousWeekStart}::date AND ${weekEnd}::date
      GROUP BY 1`);
    const totals = (thisWeek: boolean): DeadheadWeekTotals | null => {
      const row = result.rows.find((r) => r.this_week === thisWeek);
      return row ? { emptyMiles: BigInt(row.empty_miles), totalMiles: BigInt(row.total_miles) } : null;
    };
    return { thisWeek: totals(true), previousWeek: totals(false) };
  }

  // Query 5: uninvoiced loads (03 §6.0.4) through the billing module's shared predicate, so
  // this count always equals GET /billing/uninvoiced-loads (the header's "Invoice N loads").
  async unbilledLoads(db: DbExecutor, organizationId: string): Promise<{ count: number; amountCents: bigint }> {
    const result = await db.execute<UnbilledDbRow>(sql`SELECT count(*)::int AS load_count,
             coalesce(sum(${REVENUE}), 0)::bigint::text AS amount_cents
      FROM loads l
      WHERE l.organization_id = ${organizationId} AND ${uninvoicedLoadPredicate('l')}`);
    const row = result.rows[0];
    return { count: row?.load_count ?? 0, amountCents: BigInt(row?.amount_cents ?? '0') };
  }

  // Query 6: the whole roster in roster order (drivers_org_position_idx).
  async drivers(db: DbExecutor, organizationId: string): Promise<DashboardDriverRecord[]> {
    return db
      .select({
        id: drivers.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        dutyStatus: drivers.dutyStatus,
        hosRemainingMinutes: drivers.hosRemainingMinutes,
      })
      .from(drivers)
      .innerJoin(employees, and(eq(employees.organizationId, drivers.organizationId), eq(employees.id, drivers.employeeId)))
      .where(eq(drivers.organizationId, organizationId))
      .orderBy(asc(drivers.position), asc(drivers.id));
  }
}
