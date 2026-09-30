import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@runtruck/database';
import type { CustomerOption, CustomerStanding, PaymentTerms } from '@runtruck/types';
import { and, eq, type SQL, sql } from 'drizzle-orm';
import { type Database, DB } from '../database/database.module.js';

const { customers } = schema;

// One CRM row as read from PostgreSQL (docs/api/customers.md §2.7). bigint sums arrive
// as strings from node-postgres.
export type CustomerSqlRow = {
  id: string;
  name: string;
  standing: CustomerStanding;
  payment_terms: PaymentTerms;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  loads_ytd: number;
  revenue_ytd: string | number;
  late_ytd: number;
  ar_balance: string | number;
};

export interface CustomerOptionsPage {
  rows: CustomerOption[];
  total: number;
}

// `q` as a literal substring for ILIKE: %, _ and the escape character itself lose their meaning.
export function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

@Injectable()
export class CustomersRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Every customer of the organization with its YTD load aggregates and open AR, in one
  // statement (customers.md §2.7). It reads only this year's candidate loads (a stop dated
  // in YTD, or a stop-less load invoiced in YTD, 01 C8) and the open invoices, never the
  // organization's whole history; stops are looked up per candidate load (LATERAL … LIMIT 1).
  // Every table read and every join is scoped to the organization.
  //   load date = first pickup's appointment date, else the first invoice's issue date;
  //   revenue   = line haul + fuel surcharge + accessorials, cast to bigint before adding;
  //   late      = status delayed, or the last delivery arrived after its appointment date +
  //               window close (23:59 when open-ended) as wall clock in the stop's timezone.
  async listAll(organizationId: string, ytdStart: string, today: string): Promise<CustomerSqlRow[]> {
    const result = await this.db.execute<CustomerSqlRow>(sql`
      WITH candidate AS (
        SELECT s.load_id AS id
        FROM load_stops s
        WHERE s.organization_id = ${organizationId} AND s.appointment_date BETWEEN ${ytdStart}::date AND ${today}::date
        UNION
        SELECT ii.load_id
        FROM invoices i
        JOIN invoice_items ii ON ii.organization_id = i.organization_id AND ii.invoice_id = i.id
        WHERE i.organization_id = ${organizationId} AND i.issued_on BETWEEN ${ytdStart}::date AND ${today}::date AND ii.load_id IS NOT NULL),
      ytd_load AS (
        SELECT l.customer_id, l.status,
               l.line_haul_cents::bigint + l.fuel_surcharge_cents + l.accessorial_cents AS revenue,
               ls.appointment_date AS last_on, ls.window_close, ls.timezone, ls.arrived_at
        FROM candidate c
        JOIN loads l ON l.organization_id = ${organizationId} AND l.id = c.id
        LEFT JOIN LATERAL (SELECT s.appointment_date FROM load_stops s
                           WHERE s.organization_id = l.organization_id AND s.load_id = l.id
                           ORDER BY (s.kind <> 'pickup'), s.sequence LIMIT 1) fs ON true
        LEFT JOIN LATERAL (SELECT s.appointment_date, s.window_close, s.timezone, s.arrived_at FROM load_stops s
                           WHERE s.organization_id = l.organization_id AND s.load_id = l.id
                           ORDER BY (s.kind <> 'delivery'), s.sequence DESC LIMIT 1) ls ON true
        LEFT JOIN LATERAL (SELECT min(i.issued_on) AS issued_on FROM invoice_items ii
                           JOIN invoices i ON i.organization_id = ii.organization_id AND i.id = ii.invoice_id
                           WHERE ii.organization_id = l.organization_id AND ii.load_id = l.id) fi ON true
        WHERE coalesce(fs.appointment_date, fi.issued_on) BETWEEN ${ytdStart}::date AND ${today}::date),
      ytd AS (
        SELECT customer_id,
               count(*)::int AS loads_ytd,
               sum(revenue)::bigint AS revenue_ytd,
               (count(*) FILTER (WHERE status = 'delayed'
                  OR arrived_at > ((last_on + coalesce(window_close, time '23:59')) AT TIME ZONE timezone)))::int AS late_ytd
        FROM ytd_load
        GROUP BY customer_id),
      ar AS (
        SELECT i.customer_id, sum(coalesce(t.total, 0) - coalesce(p.paid, 0))::bigint AS ar_balance
        FROM invoices i
        LEFT JOIN LATERAL (SELECT sum(ii.amount_cents) AS total FROM invoice_items ii
                           WHERE ii.organization_id = i.organization_id AND ii.invoice_id = i.id) t ON true
        LEFT JOIN LATERAL (SELECT sum(py.amount_cents) AS paid FROM payments py
                           WHERE py.organization_id = i.organization_id AND py.invoice_id = i.id) p ON true
        WHERE i.organization_id = ${organizationId} AND i.status IN ('sent', 'overdue')
        GROUP BY i.customer_id)
      SELECT c.id, c.name, c.standing, c.payment_terms,
             cc.id AS contact_id, cc.full_name AS contact_name, cc.email AS contact_email,
             coalesce(ytd.loads_ytd, 0) AS loads_ytd, coalesce(ytd.revenue_ytd, 0) AS revenue_ytd,
             coalesce(ytd.late_ytd, 0) AS late_ytd, coalesce(ar.ar_balance, 0) AS ar_balance
      FROM customers c
      LEFT JOIN customer_contacts cc ON cc.organization_id = c.organization_id AND cc.customer_id = c.id AND cc.is_primary
      LEFT JOIN ytd ON ytd.customer_id = c.id
      LEFT JOIN ar ON ar.customer_id = c.id
      WHERE c.organization_id = ${organizationId}
      ORDER BY c.position, c.id`);
    return result.rows;
  }

  // The New Load select list (customers.md §2.8): the customers table only, `q` over the
  // name as an escaped ILIKE, paged in SQL with the total as a window count.
  async listOptions(organizationId: string, page: { q?: string | undefined; limit: number; offset: number }): Promise<CustomerOptionsPage> {
    const filters: SQL[] = [eq(customers.organizationId, organizationId)];
    if (page.q) filters.push(sql`${customers.name} ilike ${likeContains(page.q)} escape '\\'`);
    const where = and(...filters);

    const rows = await this.db
      .select({ id: customers.id, name: customers.name, paymentTerms: customers.paymentTerms, total: sql<number>`(count(*) over ())::int` })
      .from(customers)
      .where(where)
      .orderBy(customers.position, customers.id)
      .limit(page.limit)
      .offset(page.offset);

    // A page past the end has no row to carry the window count.
    let total = rows[0]?.total ?? 0;
    if (rows.length === 0 && page.offset > 0) {
      const [count] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(customers)
        .where(where);
      total = count?.n ?? 0;
    }
    return { rows: rows.map(({ id, name, paymentTerms }) => ({ id, name, paymentTerms })), total };
  }
}
