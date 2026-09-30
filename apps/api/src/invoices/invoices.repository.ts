import { Injectable } from '@nestjs/common';
import type { DbExecutor } from '@runtruck/database';
import type { ArAging, InvoiceRow, InvoiceStatus, PaymentMethod } from '@runtruck/types';
import { type SQL, sql } from 'drizzle-orm';
import { toNumber } from '../common/list/list-query.js';

// Invoices of one status (docs/api/billing.md §4). Totals, payments and ages are computed
// from items and payments on read (03 §1.8, §6.0.7). Every relation, including every
// joined one, carries the organization predicate.

// Row order per status (billing.md §4.2); fixed strings, never user input. The paid order
// reads `lp`, the page row's latest payment (LATEST_PAYMENT).
const ORDER_BY: Record<InvoiceStatus, SQL> = {
  sent: sql.raw('i.issued_on DESC, i.invoice_number ASC'),
  overdue: sql.raw('i.issued_on ASC, i.invoice_number ASC'),
  paid: sql.raw('lp.received_at DESC NULLS LAST, i.invoice_number ASC'),
  draft: sql.raw('i.invoice_number DESC'),
};

interface InvoiceDbRow extends Record<string, unknown> {
  id: string;
  invoice_number: number;
  customer_id: string;
  customer_name: string;
  status: InvoiceStatus;
  issued_on: string | null;
  due_on: string | null;
  age_days: number | null;
  days_past_due: number | null;
  amount_cents: string;
  paid_cents: string;
  load_id: string | null;
  load_number: number | null;
  payment_id: string | null;
  received_at: string | null;
  paid_on: string | null;
  method: PaymentMethod | null;
  factoring_company_id: string | null;
  factoring_company_name: string | null;
  payment_cents: number | null;
  days_to_pay: number | null;
}

function toInvoiceRow(r: InvoiceDbRow): InvoiceRow {
  const amountCents = toNumber(r.amount_cents);
  const paidCents = toNumber(r.paid_cents);
  return {
    id: r.id,
    invoiceNumber: r.invoice_number,
    customerId: r.customer_id,
    customerName: r.customer_name,
    loadId: r.load_id,
    loadNumber: r.load_number,
    status: r.status,
    issuedOn: r.issued_on,
    dueOn: r.due_on,
    ageDays: r.age_days,
    daysPastDue: r.days_past_due,
    amountCents,
    paidCents,
    outstandingCents: amountCents - paidCents,
    latestPayment:
      r.payment_id && r.received_at && r.paid_on && r.method && r.payment_cents !== null
        ? {
            paymentId: r.payment_id,
            receivedAt: r.received_at,
            paidOn: r.paid_on,
            method: r.method,
            factoringCompanyId: r.factoring_company_id,
            factoringCompanyName: r.factoring_company_name,
            amountCents: r.payment_cents,
          }
        : null,
    daysToPay: r.days_to_pay,
  };
}

// Invoice total and paid amount (lateral sums over the invoice's own rows).
const TOTALS = sql`LEFT JOIN LATERAL (SELECT sum(ii.amount_cents) AS total_cents FROM invoice_items ii
                     WHERE ii.organization_id = i.organization_id AND ii.invoice_id = i.id) t ON true
  LEFT JOIN LATERAL (SELECT sum(py.amount_cents) AS paid_cents FROM payments py
                     WHERE py.organization_id = i.organization_id AND py.invoice_id = i.id) pt ON true`;

// The invoice's latest payment (received_at DESC, id DESC) and its factoring company.
const LATEST_PAYMENT = sql`LEFT JOIN LATERAL (SELECT py.* FROM payments py
                     WHERE py.organization_id = i.organization_id AND py.invoice_id = i.id
                     ORDER BY py.received_at DESC, py.id DESC LIMIT 1) lp ON true
  LEFT JOIN factoring_companies fc ON fc.organization_id = lp.organization_id AND fc.id = lp.factoring_company_id`;

// The ids of one page of invoices of `status`, in list order, chosen before any row is
// decorated with totals, its first item's load and its latest payment (billing.md §4.7), so a
// page costs the same whatever the organization's history. Returns the CTE `page (id)`.
function pageIds(organizationId: string, status: InvoiceStatus, limit: number, offset: number): SQL {
  if (status !== 'paid') {
    return sql`page AS MATERIALIZED (
        SELECT i.id FROM invoices i
        WHERE i.organization_id = ${organizationId} AND i.status = ${status}
        ORDER BY ${ORDER_BY[status]}
        LIMIT ${limit} OFFSET ${offset})`;
  }
  // `paid` is the terminal status, so it grows with the whole history. Walk the payments
  // newest first (payments_org_received_idx, backward), keep each paid invoice's latest one
  // (no later payment of the same invoice by received_at, id), and stop after offset + limit;
  // paid invoices without any payment sort last (NULLS LAST, then invoice_number) and are
  // only read when the payments run out before the page is full (a one-time filter).
  const needed = offset + limit;
  return sql`head AS MATERIALIZED (
        SELECT i.id, py.received_at, i.invoice_number
        FROM payments py
        JOIN invoices i ON i.organization_id = py.organization_id AND i.id = py.invoice_id
        WHERE py.organization_id = ${organizationId} AND i.status = 'paid'
          AND NOT EXISTS (SELECT 1 FROM payments later
                          WHERE later.organization_id = py.organization_id AND later.invoice_id = py.invoice_id
                            AND (later.received_at, later.id) > (py.received_at, py.id))
        ORDER BY py.received_at DESC, i.invoice_number ASC
        LIMIT ${needed}),
      tail AS (
        SELECT i.id, NULL::timestamptz AS received_at, i.invoice_number
        FROM invoices i
        WHERE i.organization_id = ${organizationId} AND i.status = 'paid'
          AND (SELECT count(*) FROM head) < ${needed}
          AND NOT EXISTS (SELECT 1 FROM payments py WHERE py.organization_id = i.organization_id AND py.invoice_id = i.id)
        ORDER BY i.invoice_number ASC
        LIMIT ${needed}),
      page AS MATERIALIZED (
        SELECT u.id FROM (SELECT * FROM head UNION ALL SELECT * FROM tail) u
        ORDER BY u.received_at DESC NULLS LAST, u.invoice_number ASC
        LIMIT ${limit} OFFSET ${offset})`;
}

export interface ArAgingCounts {
  rowCount: number;
  arAging: ArAging;
}

export interface OverdueAggregate {
  rowCount: number;
  amountCents: number;
  inCollectionsCount: number;
  accountsAffected: number;
  totalAccounts: number;
  oldest: { invoiceId: string; invoiceNumber: number; customerName: string; ageDays: number } | null;
}

export interface PaidAggregate {
  rowCount: number;
  paidThisMonthCount: number;
  daysToPaySum: number;
  factoredCount: number;
  factoredCents: number;
  factoringCompanyNames: string[];
  collectedThisMonthCents: number;
}

export interface DraftAggregate {
  rowCount: number;
  amountCents: number;
}

@Injectable()
export class InvoicesRepository {
  // Invoices of `status` in the status's list order (billing.md §4.7): the page's ids first
  // (pageIds), then totals, first load and latest payment for those rows only.
  async rows(
    db: DbExecutor,
    organizationId: string,
    args: { status: InvoiceStatus; today: string; timezone: string; limit: number; offset: number },
  ): Promise<InvoiceRow[]> {
    const { status, today, timezone } = args;
    const result = await db.execute<InvoiceDbRow>(sql`WITH ${pageIds(organizationId, status, args.limit, args.offset)}
      SELECT i.id, i.invoice_number, i.customer_id, cu.name AS customer_name, i.status,
             i.issued_on::text AS issued_on, i.due_on::text AS due_on,
             ${today}::date - i.issued_on AS age_days, ${today}::date - i.due_on AS days_past_due,
             coalesce(t.total_cents, 0)::bigint AS amount_cents, coalesce(pt.paid_cents, 0)::bigint AS paid_cents,
             it1.load_id, l.load_number,
             lp.id AS payment_id,
             to_char(lp.received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS received_at,
             ((lp.received_at AT TIME ZONE ${timezone}::text)::date)::text AS paid_on,
             lp.method, lp.factoring_company_id, fc.name AS factoring_company_name, lp.amount_cents AS payment_cents,
             (lp.received_at AT TIME ZONE ${timezone}::text)::date - i.issued_on AS days_to_pay
      FROM page p
      JOIN invoices i ON i.organization_id = ${organizationId} AND i.id = p.id
      JOIN customers cu ON cu.organization_id = i.organization_id AND cu.id = i.customer_id
      ${TOTALS}
      LEFT JOIN invoice_items it1 ON it1.organization_id = i.organization_id AND it1.invoice_id = i.id AND it1.position = 1
      LEFT JOIN loads l ON l.organization_id = i.organization_id AND l.id = it1.load_id
      ${LATEST_PAYMENT}
      ORDER BY ${ORDER_BY[status]}`);
    return result.rows.map(toInvoiceRow);
  }

  // Invoiced KPI tiles: AR aging over sent + overdue invoices by days past due (billing.md §4.3).
  async arAging(db: DbExecutor, organizationId: string, today: string): Promise<ArAgingCounts> {
    const result = await db.execute<Record<string, number | string>>(sql`WITH open_invoices AS (
        SELECT i.status, ${today}::date - i.due_on AS days_past_due,
               coalesce(t.total_cents, 0) - coalesce(pt.paid_cents, 0) AS outstanding
        FROM invoices i
        ${TOTALS}
        WHERE i.organization_id = ${organizationId} AND i.status IN ('sent', 'overdue')
      )
      SELECT (count(*) FILTER (WHERE status = 'sent'))::int AS row_count,
             (count(*) FILTER (WHERE days_past_due <= 0))::int AS current_count,
             coalesce(sum(outstanding) FILTER (WHERE days_past_due <= 0), 0)::bigint AS current_cents,
             (count(*) FILTER (WHERE days_past_due BETWEEN 1 AND 30))::int AS d1_count,
             coalesce(sum(outstanding) FILTER (WHERE days_past_due BETWEEN 1 AND 30), 0)::bigint AS d1_cents,
             (count(*) FILTER (WHERE days_past_due BETWEEN 31 AND 60))::int AS d31_count,
             coalesce(sum(outstanding) FILTER (WHERE days_past_due BETWEEN 31 AND 60), 0)::bigint AS d31_cents,
             (count(*) FILTER (WHERE days_past_due > 60))::int AS d60_count,
             coalesce(sum(outstanding) FILTER (WHERE days_past_due > 60), 0)::bigint AS d60_cents
      FROM open_invoices`);
    const r = result.rows[0];
    if (!r) throw new Error('AR aging returned no row');
    const bucket = (count: string, cents: string) => ({ invoiceCount: toNumber(r[count]), amountCents: toNumber(r[cents]) });
    return {
      rowCount: toNumber(r.row_count),
      arAging: {
        current: bucket('current_count', 'current_cents'),
        days1To30: bucket('d1_count', 'd1_cents'),
        days31To60: bucket('d31_count', 'd31_cents'),
        days60Plus: bucket('d60_count', 'd60_cents'),
      },
    };
  }

  // Past Due KPI figures over every overdue invoice (billing.md §4.4).
  async overdueAggregate(db: DbExecutor, organizationId: string, today: string): Promise<OverdueAggregate> {
    const result = await db.execute<{
      row_count: number;
      amount_cents: string;
      in_collections_count: number;
      accounts_affected: number;
      total_accounts: number;
      oldest_id: string | null;
      oldest_number: number | null;
      oldest_customer: string | null;
      oldest_age: number | null;
    }>(sql`WITH overdue AS (
        SELECT i.id, i.invoice_number, i.customer_id, cu.name AS customer_name, i.issued_on,
               ${today}::date - i.issued_on AS age_days,
               coalesce(t.total_cents, 0) - coalesce(pt.paid_cents, 0) AS outstanding
        FROM invoices i
        JOIN customers cu ON cu.organization_id = i.organization_id AND cu.id = i.customer_id
        ${TOTALS}
        WHERE i.organization_id = ${organizationId} AND i.status = 'overdue'
      )
      SELECT agg.*, o.id AS oldest_id, o.invoice_number AS oldest_number, o.customer_name AS oldest_customer, o.age_days AS oldest_age
      FROM (
        SELECT count(*)::int AS row_count,
               coalesce(sum(outstanding), 0)::bigint AS amount_cents,
               (count(*) FILTER (WHERE age_days > 60))::int AS in_collections_count,
               count(DISTINCT customer_id)::int AS accounts_affected,
               (SELECT count(*) FROM customers c WHERE c.organization_id = ${organizationId})::int AS total_accounts
        FROM overdue) agg
      LEFT JOIN LATERAL (SELECT id, invoice_number, customer_name, age_days FROM overdue
                         ORDER BY issued_on ASC, invoice_number ASC LIMIT 1) o ON true`);
    const r = result.rows[0];
    if (!r) throw new Error('Past Due summary returned no row');
    return {
      rowCount: r.row_count,
      amountCents: toNumber(r.amount_cents),
      inCollectionsCount: r.in_collections_count,
      accountsAffected: r.accounts_affected,
      totalAccounts: r.total_accounts,
      oldest:
        r.oldest_id && r.oldest_number !== null && r.oldest_customer !== null && r.oldest_age !== null
          ? { invoiceId: r.oldest_id, invoiceNumber: r.oldest_number, customerName: r.oldest_customer, ageDays: r.oldest_age }
          : null,
    };
  }

  // Paid KPI figures (billing.md §4.5). `month` is the current org month [start, next).
  // The figures cover every paid invoice by definition (avgDaysToPay, factoring), so this
  // reads the paid history once, set-based, with no per-invoice lateral or subquery: each
  // invoice's latest payment comes from one window pass over the organization's payments,
  // and the factored total from one join of the factored paid invoices with their items.
  async paidAggregate(db: DbExecutor, organizationId: string, args: { timezone: string; month: { start: string; next: string } }): Promise<PaidAggregate> {
    const { timezone, month } = args;
    const result = await db.execute<{
      row_count: number;
      paid_this_month_count: number;
      days_to_pay_sum: string;
      factored_count: number;
      factored_cents: string;
      factoring_company_names: string[];
      collected_this_month_cents: string;
    }>(sql`WITH paid AS (
        SELECT i.id, lp.method, fc.name AS factoring_company_name,
               (lp.received_at AT TIME ZONE ${timezone}::text)::date AS paid_on,
               (lp.received_at AT TIME ZONE ${timezone}::text)::date - i.issued_on AS days_to_pay
        FROM invoices i
        LEFT JOIN (
          SELECT py.invoice_id, py.received_at, py.method, py.factoring_company_id,
                 row_number() OVER (PARTITION BY py.invoice_id ORDER BY py.received_at DESC, py.id DESC) AS rn
          FROM payments py
          WHERE py.organization_id = ${organizationId}
        ) lp ON lp.invoice_id = i.id AND lp.rn = 1
        LEFT JOIN factoring_companies fc ON fc.organization_id = ${organizationId} AND fc.id = lp.factoring_company_id
        WHERE i.organization_id = ${organizationId} AND i.status = 'paid'
      ),
      factored AS (
        SELECT coalesce(sum(ii.amount_cents), 0) AS cents
        FROM paid p
        JOIN invoice_items ii ON ii.organization_id = ${organizationId} AND ii.invoice_id = p.id
        WHERE p.method = 'factoring'
      )
      SELECT count(*)::int AS row_count,
             (count(*) FILTER (WHERE paid_on >= ${month.start}::date AND paid_on < ${month.next}::date))::int AS paid_this_month_count,
             coalesce(sum(days_to_pay), 0)::bigint AS days_to_pay_sum,
             (count(*) FILTER (WHERE method = 'factoring'))::int AS factored_count,
             (SELECT cents FROM factored)::bigint AS factored_cents,
             coalesce(array_agg(DISTINCT factoring_company_name ORDER BY factoring_company_name)
                        FILTER (WHERE method = 'factoring' AND factoring_company_name IS NOT NULL), '{}')::text[] AS factoring_company_names,
             (SELECT coalesce(sum(py.amount_cents), 0) FROM payments py
               WHERE py.organization_id = ${organizationId}
                 AND py.received_at >= (${month.start}::date::timestamp AT TIME ZONE ${timezone}::text)
                 AND py.received_at < (${month.next}::date::timestamp AT TIME ZONE ${timezone}::text))::bigint AS collected_this_month_cents
      FROM paid`);
    const r = result.rows[0];
    if (!r) throw new Error('Paid summary returned no row');
    return {
      rowCount: r.row_count,
      paidThisMonthCount: r.paid_this_month_count,
      daysToPaySum: toNumber(r.days_to_pay_sum),
      factoredCount: r.factored_count,
      factoredCents: toNumber(r.factored_cents),
      factoringCompanyNames: r.factoring_company_names,
      collectedThisMonthCents: toNumber(r.collected_this_month_cents),
    };
  }

  // Draft summary (billing.md §4.6).
  async draftAggregate(db: DbExecutor, organizationId: string): Promise<DraftAggregate> {
    const result = await db.execute<{ row_count: number; amount_cents: string }>(sql`SELECT count(*)::int AS row_count,
             coalesce(sum(t.total_cents), 0)::bigint AS amount_cents
      FROM invoices i
      ${TOTALS}
      WHERE i.organization_id = ${organizationId} AND i.status = 'draft'`);
    const r = result.rows[0];
    if (!r) throw new Error('Draft summary returned no row');
    return { rowCount: r.row_count, amountCents: toNumber(r.amount_cents) };
  }
}
