import { type Database, type DbExecutor, schema } from '@runtruck/database';
import type { InvoiceRow } from '@runtruck/types';
import { eq, SQL, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Agent } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UninvoicedLoadsQuery } from '../src/billing/uninvoiced-loads.query.js';
import { CustomersRepository } from '../src/customers/customers.repository.js';
import { InvoicesRepository } from '../src/invoices/invoices.repository.js';
import { LoadsRepository } from '../src/loads/loads.repository.js';
import { PlannerRepository } from '../src/planner/planner.repository.js';
import { createTestContext, type TestContext } from './helpers.js';

// Query-shape regressions of the performance review (docs/04-api.md §5.1, docs/01 C73, C85):
// indexes that supply the list order, page-first statements that decorate only the page's
// rows, set-based summaries, and no window count over the whole board. The data is small,
// so these check plan *structure* (which nodes exist, how often per-row nodes run) under
// EXPLAIN ANALYZE, not timings.

let t: TestContext;
let rosa: Agent;
let demo: string;
const TZ = 'America/Los_Angeles';
const dialect = new PgDialect({ casing: 'snake_case' });

beforeAll(async () => {
  t = await createTestContext();
  demo = t.orgs.demoOrganizationId;
  rosa = await t.as('admin');
});
afterAll(async () => {
  await t.close();
});

interface PlanNode {
  'Node Type': string;
  'Parent Relationship'?: string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Sort Key'?: string[];
  'Actual Loops': number;
  Plans?: PlanNode[];
}

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flatten)];
}

// EXPLAIN ANALYZE of a statement, serial (no parallel workers) so loop counts are per row.
async function explain(query: SQL | { sql: string; params: unknown[] }, settings: string[] = []): Promise<PlanNode[]> {
  const client = await t.db.pool.connect();
  try {
    await client.query('begin');
    for (const s of ['max_parallel_workers_per_gather = 0', ...settings]) await client.query(`set local ${s}`);
    const { sql: text, params } = query instanceof SQL ? dialect.sqlToQuery(query) : query;
    const result = await client.query<{ 'QUERY PLAN': [{ Plan: PlanNode }] }>(`explain (analyze, format json) ${text}`, params);
    return flatten(result.rows[0]!['QUERY PLAN'][0].Plan);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

// A Database whose statements are recorded (for repositories built on the query builder).
function recordingDb(): { db: Database; statements: { sql: string; params: unknown[] }[] } {
  const statements: { sql: string; params: unknown[] }[] = [];
  const db = drizzle({
    client: t.db.pool,
    schema,
    casing: 'snake_case',
    logger: { logQuery: (q, params) => statements.push({ sql: q, params }) },
  });
  return { db, statements };
}

// A DbExecutor whose raw `execute` statements are recorded (for repositories built on sql``).
function recordingExecutor(): { db: DbExecutor; statements: SQL[] } {
  const statements: SQL[] = [];
  const db = {
    execute: (q: SQL) => {
      statements.push(q);
      return t.db.db.execute(q);
    },
  } as unknown as DbExecutor;
  return { db, statements };
}

describe('indexes supply the list order (DESC = NULLS FIRST)', () => {
  it('declares the board and violations indexes in their ORDER BY exactly', async () => {
    const defs = await t.db.db.execute<{ indexname: string; indexdef: string }>(
      sql`select indexname, indexdef from pg_indexes where schemaname = 'public' and indexname in
          ('loads_org_board_idx', 'violations_org_occurred_idx', 'loads_org_board_status_idx', 'load_activity_org_load_created_idx', 'invoices_org_issued_idx')`,
    );
    const def = Object.fromEntries(defs.rows.map((r) => [r.indexname, r.indexdef]));
    expect(def.loads_org_board_idx).toContain('(organization_id, created_at DESC, load_number DESC) WHERE (archived_at IS NULL)');
    expect(def.violations_org_occurred_idx).toContain('(organization_id, occurred_on DESC, id)');
    expect(def.loads_org_board_status_idx).toContain('(organization_id, status) WHERE (archived_at IS NULL)');
    expect(def.load_activity_org_load_created_idx).toMatch(/\(organization_id, load_id, sequence\) WHERE \(kind = 'created'/);
    expect(def.invoices_org_issued_idx).toContain('(organization_id, issued_on)');
    for (const d of Object.values(def)) expect(d).not.toContain('NULLS LAST');
  });

  it('reads the board and the violations list in index order, with no Sort', async () => {
    const forceIndex = ['enable_seqscan = off', 'enable_bitmapscan = off'];
    const board = await explain(
      sql`select id from loads where organization_id = ${demo} and archived_at is null order by created_at desc, load_number desc limit 5`,
      forceIndex,
    );
    expect(board.some((n) => n['Index Name'] === 'loads_org_board_idx')).toBe(true);
    expect(board.some((n) => n['Node Type'].includes('Sort'))).toBe(false);
    const violations = await explain(
      sql`select id from violations v where v.organization_id = ${demo} order by v.occurred_on desc, v.id limit 5`,
      forceIndex,
    );
    expect(violations.some((n) => n['Index Name'] === 'violations_org_occurred_idx')).toBe(true);
    expect(violations.some((n) => n['Node Type'].includes('Sort'))).toBe(false);
  });
});

describe('board pages (01 C85)', () => {
  it('GET /loads pages in SQL with the view count as total, at any offset', async () => {
    const all = (await rosa.get('/api/v1/loads?view=all&limit=500').expect(200)).body as {
      data: { id: string }[];
      meta: { total: number; summary: { views: Record<string, number> } };
    };
    expect(all.meta.total).toBe(all.data.length);
    expect(all.meta.total).toBe(all.meta.summary.views.all);
    const paged: string[] = [];
    for (let offset = 0; offset < all.data.length + 3; offset += 3) {
      const page = (await rosa.get(`/api/v1/loads?view=all&limit=3&offset=${offset}`).expect(200)).body as {
        data: { id: string }[];
        meta: { total: number };
      };
      expect(page.meta.total).toBe(all.meta.total);
      paged.push(...page.data.map((r) => r.id));
    }
    expect(paged).toEqual(all.data.map((r) => r.id));
    for (const view of ['active', 'needs-pod', 'delivered']) {
      const res = (await rosa.get(`/api/v1/loads?view=${view}&limit=500`).expect(200)).body as {
        data: unknown[];
        meta: { total: number; summary: { views: Record<string, number> } };
      };
      expect(res.meta.total).toBe(res.data.length);
      expect(res.meta.total).toBe(res.meta.summary.views[view]);
    }
  });

  it('boardPage chooses the page first: no window count, the created-activity lookup only for page rows', async () => {
    const { db, statements } = recordingDb();
    const rows = await new LoadsRepository(db).boardPage(demo, null, 3, 4);
    expect(rows).toHaveLength(3);
    const plan = await explain(statements[0]!);
    expect(plan.some((n) => n['Node Type'] === 'WindowAgg')).toBe(false);
    const subplans = plan.filter((n) => n['Parent Relationship'] === 'SubPlan');
    expect(subplans.length).toBeGreaterThan(0);
    // Before: evaluated for every row up to OFFSET + LIMIT (7), including skipped ones.
    for (const s of subplans) expect(s['Actual Loops']).toBeLessThanOrEqual(3);
  });

  it('the planner board and the event-card sample carry no window count', async () => {
    const { db, statements } = recordingDb();
    const repository = new PlannerRepository(db);
    const page = await repository.boardLoads(demo, 2, 1);
    const sample = await repository.firstPickupEvent(demo);
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBeGreaterThan(2);
    expect(sample).not.toBeNull();
    for (const statement of statements) {
      const plan = await explain(statement);
      expect(plan.some((n) => n['Node Type'] === 'WindowAgg')).toBe(false);
    }
  });
});

describe('Paid invoices (billing.md §4.7, §4.5)', () => {
  const extra = 45;

  beforeAll(async () => {
    const [customer] = await t.db.db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(eq(schema.customers.organizationId, demo))
      .limit(1);
    const [factor] = await t.db.db
      .select({ id: schema.factoringCompanies.id })
      .from(schema.factoringCompanies)
      .where(eq(schema.factoringCompanies.organizationId, demo))
      .limit(1);
    const invoices = await t.db.db
      .insert(schema.invoices)
      .values(
        Array.from({ length: extra }, (_, i) => ({
          organizationId: demo,
          invoiceNumber: 90_000 + i,
          customerId: customer!.id,
          status: 'paid' as const,
          paymentTerms: 'net_30' as const,
          issuedOn: '2026-07-01',
          dueOn: '2026-07-31',
        })),
      )
      .returning({ id: schema.invoices.id, invoiceNumber: schema.invoices.invoiceNumber });
    await t.db.db
      .insert(schema.invoiceItems)
      .values(
        invoices.map((inv) => ({
          organizationId: demo,
          invoiceId: inv.id,
          position: 1,
          description: 'Freight',
          amountCents: 1_000 + inv.invoiceNumber - 90_000,
        })),
      );
    const at = (hours: number) => new Date(Date.UTC(2026, 7, 1, 0, 0, 0) + hours * 3_600_000);
    const payments = invoices.flatMap((inv) => {
      const k = inv.invoiceNumber - 90_000;
      if (k % 3 === 0) return []; // paid without a payment row: sorts last
      const latest = k >= 30 && k < 34 ? at(500) : at(k * 7); // four invoices tie on the latest instant
      const method = k % 4 === 1 ? ('factoring' as const) : ('ach' as const);
      const rows = [
        {
          organizationId: demo,
          invoiceId: inv.id,
          receivedAt: latest,
          method,
          factoringCompanyId: method === 'factoring' ? factor!.id : null,
          amountCents: 500,
        },
      ];
      if (k % 3 === 2)
        rows.push({
          organizationId: demo,
          invoiceId: inv.id,
          receivedAt: at(k * 7 - 100),
          method: 'ach',
          factoringCompanyId: null,
          amountCents: 500,
        });
      return rows;
    });
    await t.db.db.insert(schema.payments).values(payments);
  });

  // The definition (each invoice's latest payment, NULLS LAST, then the number), as a lateral.
  async function expectedOrder(): Promise<number[]> {
    const result = await t.db.db.execute<{ invoice_number: number }>(sql`select i.invoice_number from invoices i
      left join lateral (select py.received_at from payments py where py.organization_id = i.organization_id and py.invoice_id = i.id
                         order by py.received_at desc, py.id desc limit 1) lp on true
      where i.organization_id = ${demo} and i.status = 'paid'
      order by lp.received_at desc nulls last, i.invoice_number asc`);
    return result.rows.map((r) => r.invoice_number);
  }

  it('lists every paid invoice in order, and pages across the paid-without-payment tail', async () => {
    const expected = await expectedOrder();
    expect(expected.length).toBeGreaterThan(extra);
    const all = (await rosa.get('/api/v1/invoices?status=paid&limit=500').expect(200)).body as {
      data: InvoiceRow[];
      meta: { total: number };
    };
    expect(all.data.map((r) => r.invoiceNumber)).toEqual(expected);
    expect(all.meta.total).toBe(expected.length);
    const paged: number[] = [];
    for (let offset = 0; offset < expected.length + 7; offset += 7) {
      const page = (await rosa.get(`/api/v1/invoices?status=paid&limit=7&offset=${offset}`).expect(200)).body as { data: InvoiceRow[] };
      paged.push(...page.data.map((r) => r.invoiceNumber));
    }
    expect(paged).toEqual(expected);
  });

  it('decorates only the page: totals and the latest payment run once per page row', async () => {
    const { db, statements } = recordingExecutor();
    const rows = await new InvoicesRepository().rows(db, demo, { status: 'paid', today: '2026-09-03', timezone: TZ, limit: 5, offset: 10 });
    expect(rows).toHaveLength(5);
    const plan = await explain(statements[0]!);
    const perRow = plan.filter((n) => n['Node Type'] === 'Aggregate' || n['Node Type'] === 'Limit');
    expect(perRow.length).toBeGreaterThan(0);
    // Before: once per paid invoice of the organization (here more than 50).
    for (const n of perRow) expect(n['Actual Loops']).toBeLessThanOrEqual(5);
  });

  it('computes the summary set-based and equal to the per-invoice definition', async () => {
    const month = { start: '2026-09-01', next: '2026-10-01' };
    const { db, statements } = recordingExecutor();
    const summary = await new InvoicesRepository().paidAggregate(db, demo, { timezone: TZ, month });
    const plan = await explain(statements[0]!);
    expect(plan.some((n) => n['Parent Relationship'] === 'SubPlan')).toBe(false);
    for (const n of plan.filter((p) => p['Node Type'] === 'Aggregate' || p['Node Type'] === 'Limit'))
      expect(n['Actual Loops']).toBeLessThanOrEqual(1);

    const oracle = await t.db.db.execute<{ row_count: number; days: string; factored_count: number; factored_cents: string }>(sql`
      select count(*)::int as row_count,
             coalesce(sum((lp.received_at at time zone ${TZ}::text)::date - i.issued_on), 0)::bigint as days,
             (count(*) filter (where lp.method = 'factoring'))::int as factored_count,
             coalesce(sum(t.total) filter (where lp.method = 'factoring'), 0)::bigint as factored_cents
      from invoices i
      left join lateral (select sum(ii.amount_cents) as total from invoice_items ii where ii.organization_id = i.organization_id and ii.invoice_id = i.id) t on true
      left join lateral (select py.* from payments py where py.organization_id = i.organization_id and py.invoice_id = i.id
                         order by py.received_at desc, py.id desc limit 1) lp on true
      where i.organization_id = ${demo} and i.status = 'paid'`);
    const o = oracle.rows[0]!;
    expect(summary.rowCount).toBe(o.row_count);
    expect(summary.daysToPaySum).toBe(Number(o.days));
    expect(summary.factoredCount).toBe(o.factored_count);
    expect(summary.factoredCents).toBe(Number(o.factored_cents));
    expect(summary.factoredCount).toBeGreaterThan(0);
  });
});

describe('uninvoiced loads (billing.md §3.3, 01 C86)', () => {
  it('reads the page and the summary in one statement over one uninvoiced set', async () => {
    const { db, statements } = recordingExecutor();
    const full = await new UninvoicedLoadsQuery().list(db, demo, '2026-09-03', { limit: 500, offset: 0 });
    expect(statements).toHaveLength(1);
    const plan = await explain(statements[0]!);
    // The uninvoiced set comes from loads.invoiced_at (trigger-maintained, migration 0006):
    // no anti-join over invoice_items at all (01 C86).
    expect(plan.filter((n) => n['Relation Name'] === 'invoice_items')).toHaveLength(0);
    expect(full.summary.loadCount).toBe(full.rows.length);

    // A page past the end still carries the summary.
    const past = await new UninvoicedLoadsQuery().list(t.db.db, demo, '2026-09-03', { limit: 5, offset: 1_000 });
    expect(past.rows).toEqual([]);
    expect(past.summary).toEqual(full.summary);
    const res = (await rosa.get('/api/v1/billing/uninvoiced-loads?offset=1000').expect(200)).body as {
      data: unknown[];
      meta: { total: number; summary: unknown };
    };
    expect(res.data).toEqual([]);
    expect(res.meta.total).toBe(full.summary.loadCount);
  });
});

describe('CRM year-to-date (customers.md §2.7)', () => {
  it("looks up a load's first invoice lazily, only for rows whose first stop has no date", async () => {
    const { db, statements } = recordingExecutor();
    await new CustomersRepository(db).listAll(demo, '2026-01-01', '2026-09-03');
    const plan = await explain(statements[0]!);
    // The first-stop lookup: a Limit over load_stops sorted by (kind <> 'pickup'), sequence.
    const firstStop = plan.filter(
      (n) => n['Node Type'] === 'Limit' && flatten(n).some((c) => (c['Sort Key'] ?? []).some((k) => k.includes("'pickup'"))),
    );
    expect(firstStop).toHaveLength(1);
    const rowsLookedUp = firstStop[0]!['Actual Loops'];
    // The first-invoice lookup is a SubPlan inside COALESCE (evaluated only when the first stop
    // date is null), not a LATERAL per row (before: a join run for every row, whatever its stops).
    const invoiceLookups = plan.filter(
      (n) => n['Parent Relationship'] === 'SubPlan' && flatten(n).some((c) => c['Relation Name'] === 'invoice_items'),
    );
    expect(invoiceLookups.length).toBeGreaterThan(0);
    for (const s of invoiceLookups) expect(s['Actual Loops']).toBeLessThan(rowsLookedUp);
  });
});
