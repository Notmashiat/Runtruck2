import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './helpers.js';

// loads.invoiced_at (docs/03-database.md §6.0.4, docs/01 C86): maintained by the trigger
// on invoice_items, it makes "uninvoiced" an index range scan instead of an anti-join
// over the whole delivery history, without changing what the screens show.

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(async () => {
  await t.close();
});

const uninvoicedCount = async (): Promise<number> => {
  const agent = await t.as('admin');
  const res = await agent.get('/api/v1/billing/uninvoiced-loads?limit=500').expect(200);
  return (res.body as { meta: { summary: { loadCount: number } } }).meta.summary.loadCount;
};

async function loadIdOf(loadNumber: number): Promise<string> {
  const r = await t.db.db.execute<{ id: string }>(
    sql`select id from loads where organization_id = ${t.orgs.demoOrganizationId} and load_number = ${loadNumber}`,
  );
  const id = r.rows[0]?.id;
  if (!id) throw new Error(`load ${loadNumber} not seeded`);
  return id;
}

describe('loads.invoiced_at marker', () => {
  it('is set exactly on the seeded loads that have invoice lines', async () => {
    const mismatches = await t.db.db.execute<{ n: number }>(sql`
      select count(*)::int as n from loads l
      where (l.invoiced_at is not null) <> exists (
        select 1 from invoice_items ii where ii.organization_id = l.organization_id and ii.load_id = l.id)`);
    expect(mismatches.rows[0]?.n).toBe(0);
    // Runtruck1's 11 delivered, not-yet-invoiced loads are unchanged.
    expect(await uninvoicedCount()).toBe(11);
  });

  it('follows invoice lines: added, moved and removed (incl. invoice deletion cascade)', async () => {
    const db = t.db.db;
    const org = t.orgs.demoOrganizationId;
    const l40209 = await loadIdOf(40209); // uninvoiced in the seed
    const l40208 = await loadIdOf(40208); // uninvoiced in the seed
    const [inv] = (
      await db.execute<{ id: string }>(sql`
        insert into invoices (organization_id, invoice_number, customer_id, status, issued_on, due_on, payment_terms)
        select organization_id, 99001, customer_id, 'draft', null, null, payment_terms from loads where id = ${l40209}
        returning id`)
    ).rows;
    if (!inv) throw new Error('invoice insert failed');

    await db.execute(sql`insert into invoice_items (organization_id, invoice_id, position, load_id, description, amount_cents)
      values (${org}, ${inv.id}, 1, ${l40209}, 'Line haul', 245000)`);
    expect(await uninvoicedCount()).toBe(10);

    // Moving the line to another load re-opens the first and closes the second.
    await db.execute(sql`update invoice_items set load_id = ${l40208} where invoice_id = ${inv.id}`);
    const marks = await db.execute<{ load_number: number; invoiced: boolean }>(
      sql`select load_number, invoiced_at is not null as invoiced from loads where id in (${l40209}, ${l40208}) order by load_number`,
    );
    expect(marks.rows).toEqual([
      { load_number: 40208, invoiced: true },
      { load_number: 40209, invoiced: false },
    ]);
    expect(await uninvoicedCount()).toBe(10);

    // Deleting the invoice cascades to its lines, which clears the marker.
    await db.execute(sql`delete from invoices where id = ${inv.id}`);
    expect(await uninvoicedCount()).toBe(11);
  });

  it('is served from the partial index, not a scan of delivered history', async () => {
    const plan = await t.db.db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      const r = await tx.execute<{ 'QUERY PLAN': string }>(sql`explain select id from loads l
        where l.organization_id = ${t.orgs.demoOrganizationId} and l.invoiced_at is null and l.status in ('needs_pod', 'delivered')`);
      return r.rows.map((row) => row['QUERY PLAN']).join('\n');
    });
    expect(plan).toContain('loads_org_uninvoiced_idx');
  });
});
