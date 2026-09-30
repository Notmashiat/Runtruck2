import { Injectable } from '@nestjs/common';
import type { DbExecutor } from '@runtruck/database';
import type { UninvoicedLoadRow, UninvoicedLoadsSummary, UninvoicedPodStatus } from '@runtruck/types';
import { type SQL, sql } from 'drizzle-orm';
import { toNumber } from '../common/list/list-query.js';

// The uninvoiced-loads rule (docs/03-database.md §6.0.4, docs/api/billing.md §3), shared by
// GET /billing/uninvoiced-loads (and so the header's "Invoice N loads") and the Dashboard's
// "Unbilled loads" tile, which must use this predicate or UninvoicedLoadsQuery.list()
// rather than re-implement it (docs/api/dashboard.md §3).

// A load (board or archived) in a delivered status that no invoice item references (any
// invoice status, draft included). `alias` is the SQL alias of the `loads` row: a
// developer-written identifier, never request input (it is inlined, not bound).
export function uninvoicedLoadPredicate(alias = 'l'): SQL {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error(`Invalid SQL alias ${alias}`);
  const l = sql.raw(alias);
  return sql`${l}.status IN ('needs_pod', 'delivered')
    AND NOT EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.organization_id = ${l}.organization_id AND ii.load_id = ${l}.id)`;
}

// Stop route label (03 §6.0.3): the facility's market (else city/state), else the stop's own city/state.
const STOP_LABEL = sql`coalesce(f.market_city, f.city, s.city) || ', ' || coalesce(f.market_state, f.state, s.state)`;

// One row per uninvoiced load of the organization, with everything the list and the
// summary need. Every relation carries the organization predicate (billing.md §1).
// MATERIALIZED: the page, the aggregate and the oldest row all read it, so the anti-join
// runs once per request.
function uninvoicedCte(organizationId: string): SQL {
  return sql`WITH uninvoiced AS MATERIALIZED (
    SELECT l.id AS load_id, l.load_number, l.customer_id, cu.name AS customer_name,
           l.line_haul_cents::bigint + l.fuel_surcharge_cents + l.accessorial_cents AS amount_cents,
           CASE WHEN pu.label IS NULL OR dl.label IS NULL THEN NULL ELSE pu.label || ' → ' || dl.label END AS route,
           coalesce((dl.completed_at AT TIME ZONE dl.timezone)::date, dl.appointment_date) AS delivered_on,
           EXISTS (SELECT 1 FROM documents d
                   WHERE d.organization_id = l.organization_id AND d.load_id = l.id
                     AND d.document_type = 'proof_of_delivery' AND d.status = 'attached') AS pod_attached
    FROM loads l
    JOIN customers cu ON cu.organization_id = l.organization_id AND cu.id = l.customer_id
    LEFT JOIN LATERAL (
      SELECT ${STOP_LABEL} AS label
      FROM load_stops s
      LEFT JOIN facilities f ON f.organization_id = s.organization_id AND f.id = s.facility_id
      WHERE s.organization_id = l.organization_id AND s.load_id = l.id
      ORDER BY (s.kind = 'pickup') DESC, s.sequence ASC LIMIT 1) pu ON true
    LEFT JOIN LATERAL (
      SELECT s.appointment_date, s.completed_at, s.timezone, ${STOP_LABEL} AS label
      FROM load_stops s
      LEFT JOIN facilities f ON f.organization_id = s.organization_id AND f.id = s.facility_id
      WHERE s.organization_id = l.organization_id AND s.load_id = l.id
      ORDER BY (s.kind = 'delivery') DESC, s.sequence DESC LIMIT 1) dl ON true
    WHERE l.organization_id = ${organizationId} AND ${uninvoicedLoadPredicate('l')}
  )`;
}

interface UninvoicedDbRow extends Record<string, unknown> {
  load_id: string;
  load_number: number;
  customer_id: string;
  customer_name: string;
  route: string | null;
  delivered_on: string | null;
  pod_attached: boolean;
  amount_cents: string;
}

// One result row per page row, each carrying the summary columns; a page past the end
// yields one row with the summary and null page columns.
interface ListDbRow extends Record<string, unknown> {
  load_id: string | null;
  load_number: number | null;
  customer_id: string | null;
  customer_name: string | null;
  route: string | null;
  delivered_on: string | null;
  pod_attached: boolean | null;
  amount_cents: string | null;
  load_count: number;
  total_amount_cents: string;
  customer_count: number;
  missing_pod_count: number;
  oldest_load_id: string | null;
  oldest_load_number: number | null;
  oldest_delivered_on: string | null;
  oldest_age_days: number | null;
}

function toRow(r: UninvoicedDbRow): UninvoicedLoadRow {
  const podStatus: UninvoicedPodStatus = r.pod_attached ? 'attached' : 'missing';
  return {
    loadId: r.load_id,
    loadNumber: r.load_number,
    customerId: r.customer_id,
    customerName: r.customer_name,
    route: r.route,
    deliveredOn: r.delivered_on,
    podStatus,
    amountCents: toNumber(r.amount_cents),
  };
}

function toSummary(r: ListDbRow): UninvoicedLoadsSummary {
  return {
    loadCount: r.load_count,
    amountCents: toNumber(r.total_amount_cents),
    customerCount: r.customer_count,
    missingPodCount: r.missing_pod_count,
    oldest:
      r.oldest_load_id && r.oldest_load_number !== null && r.oldest_delivered_on && r.oldest_age_days !== null
        ? { loadId: r.oldest_load_id, loadNumber: r.oldest_load_number, deliveredOn: r.oldest_delivered_on, ageDays: r.oldest_age_days }
        : null,
  };
}

@Injectable()
export class UninvoicedLoadsQuery {
  // One page in list order (delivered_on DESC NULLS LAST, load_number DESC; = Runtruck1's
  // order) and the KPI figures over every uninvoiced load (billing.md §3.2), in ONE statement
  // over one materialized set, so each request evaluates the uninvoiced rule once. `today` is
  // the organization's business date.
  async list(
    db: DbExecutor,
    organizationId: string,
    today: string,
    page: { limit: number; offset: number },
  ): Promise<{ rows: UninvoicedLoadRow[]; summary: UninvoicedLoadsSummary }> {
    const result = await db.execute<ListDbRow>(sql`${uninvoicedCte(organizationId)},
      summary AS (
        SELECT count(*)::int AS load_count,
               coalesce(sum(amount_cents), 0)::bigint AS total_amount_cents,
               count(DISTINCT customer_id)::int AS customer_count,
               (count(*) FILTER (WHERE NOT pod_attached))::int AS missing_pod_count
        FROM uninvoiced),
      oldest AS (
        SELECT load_id, load_number, delivered_on FROM uninvoiced
        WHERE delivered_on IS NOT NULL
        ORDER BY delivered_on ASC, load_number DESC LIMIT 1),
      page AS (
        SELECT * FROM uninvoiced
        ORDER BY delivered_on DESC NULLS LAST, load_number DESC
        LIMIT ${page.limit} OFFSET ${page.offset})
      SELECT p.load_id, p.load_number, p.customer_id, p.customer_name, p.route, p.delivered_on::text AS delivered_on,
             p.pod_attached, p.amount_cents,
             s.load_count, s.total_amount_cents, s.customer_count, s.missing_pod_count,
             o.load_id AS oldest_load_id, o.load_number AS oldest_load_number,
             o.delivered_on::text AS oldest_delivered_on, (${today}::date - o.delivered_on) AS oldest_age_days
      FROM summary s
      LEFT JOIN oldest o ON true
      LEFT JOIN page p ON true
      ORDER BY p.delivered_on DESC NULLS LAST, p.load_number DESC`);
    const first = result.rows[0];
    if (!first) throw new Error('Uninvoiced list returned no row');
    const rows = result.rows.filter((r): r is ListDbRow & UninvoicedDbRow => r.load_id !== null).map(toRow);
    return { rows, summary: toSummary(first) };
  }
}
