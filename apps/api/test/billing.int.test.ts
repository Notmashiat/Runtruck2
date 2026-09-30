import { invoiceBatchesKpis, invoiceBatchViewRow, uninvoicedKpis, uninvoicedViewRow } from '@runtruck/calculations';
import type { InvoiceBatchRow, UninvoicedLoadRow } from '@runtruck/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './helpers.js';

// GET /billing/uninvoiced-loads and GET /invoice-batches (docs/api/billing.md §3, §5)
// against the demo seed, with today pinned to 2026-09-03.

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(async () => {
  await t.close();
});

interface Row {
  [key: string]: unknown;
}

// A Runtruck1 mock row as the web renders it: tagClass becomes the Tag tone (Runtruck1 Tag.tsx CHIP).
const TONE: Record<string, string> = { 'tag-accent': 'blue', 'tag-neutral': 'gray', 'tag-outline': 'amber', 'tag-green': 'green' };
const r1 = ({ tagClass, ...row }: { tagClass: string } & Record<string, unknown>) => ({ ...row, tone: TONE[tagClass] });

describe('GET /billing/uninvoiced-loads', () => {
  const url = '/api/v1/billing/uninvoiced-loads';

  it("returns Runtruck1's 11 uninvoiced loads in its order with the §3.2 summary", async () => {
    const agent = await t.as('admin');
    const res = await agent.get(`${url}?limit=500`).expect(200);
    const rows = res.body.data as Row[];
    expect(rows.map((r) => [r.loadNumber, r.customerName, r.route, r.deliveredOn, r.podStatus, r.amountCents])).toEqual([
      [40209, 'Northgate Foods', 'Fresno, CA → Reno, NV', '2026-09-02', 'attached', 245_000],
      [40208, 'Bayline Distribution', 'Stockton, CA → Salt Lake City, UT', '2026-09-02', 'attached', 318_000],
      [40207, 'Cascade Building Supply', 'Sacramento, CA → Boise, ID', '2026-09-02', 'missing', 291_000],
      [40206, 'Harbor Point Retail', 'Oakland, CA → Portland, OR', '2026-09-01', 'attached', 354_000],
      [40204, 'Vantage Home Goods', 'Stockton, CA → Las Vegas, NV', '2026-08-31', 'missing', 288_000],
      [40203, 'Northgate Foods', 'Bakersfield, CA → Phoenix, AZ', '2026-08-31', 'attached', 198_000],
      [40205, 'Sierra Ag Partners', 'Modesto, CA → Denver, CO', '2026-08-30', 'attached', 412_000],
      [40202, 'Bayline Distribution', 'Fresno, CA → Portland, OR', '2026-08-30', 'attached', 362_000],
      [40201, 'Cascade Building Supply', 'Redding, CA → Seattle, WA', '2026-08-29', 'attached', 276_000],
      [40200, 'Sierra Ag Partners', 'Modesto, CA → Salt Lake City, UT', '2026-08-28', 'missing', 305_000],
      [40199, 'Vantage Home Goods', 'Sacramento, CA → Denver, CO', '2026-08-27', 'attached', 441_000],
    ]);
    expect(rows[0]).toEqual({
      loadId: expect.any(String),
      loadNumber: 40209,
      customerId: expect.any(String),
      customerName: 'Northgate Foods',
      route: 'Fresno, CA → Reno, NV',
      deliveredOn: '2026-09-02',
      podStatus: 'attached',
      amountCents: 245_000,
    });
    expect(res.body.meta).toEqual({
      total: 11,
      limit: 500,
      offset: 0,
      summary: {
        loadCount: 11,
        amountCents: 3_490_000,
        customerCount: 6,
        missingPodCount: 3,
        oldest: { loadId: expect.any(String), loadNumber: 40199, deliveredOn: '2026-08-27', ageDays: 7 },
      },
    });
  });

  it("renders exactly Runtruck1's UNINVOICED rows and KPI tiles through the shared view models (§7.1)", async () => {
    const agent = await t.as('admin');
    const res = await agent.get(`${url}?limit=500`).expect(200);
    // Runtruck1 data/accounting.ts UNINVOICED, verbatim.
    expect((res.body.data as UninvoicedLoadRow[]).map(uninvoicedViewRow)).toEqual(
      [
        { id: 'L-40209', customer: 'Northgate Foods', route: 'Fresno, CA → Reno, NV', delivered: 'Sep 2', pod: 'Attached', amount: '$2,450', tagClass: 'tag-green' },
        { id: 'L-40208', customer: 'Bayline Distribution', route: 'Stockton, CA → Salt Lake City, UT', delivered: 'Sep 2', pod: 'Attached', amount: '$3,180', tagClass: 'tag-green' },
        { id: 'L-40207', customer: 'Cascade Building Supply', route: 'Sacramento, CA → Boise, ID', delivered: 'Sep 2', pod: 'Missing', amount: '$2,910', tagClass: 'tag-outline' },
        { id: 'L-40206', customer: 'Harbor Point Retail', route: 'Oakland, CA → Portland, OR', delivered: 'Sep 1', pod: 'Attached', amount: '$3,540', tagClass: 'tag-green' },
        { id: 'L-40204', customer: 'Vantage Home Goods', route: 'Stockton, CA → Las Vegas, NV', delivered: 'Aug 31', pod: 'Missing', amount: '$2,880', tagClass: 'tag-outline' },
        { id: 'L-40203', customer: 'Northgate Foods', route: 'Bakersfield, CA → Phoenix, AZ', delivered: 'Aug 31', pod: 'Attached', amount: '$1,980', tagClass: 'tag-green' },
        { id: 'L-40205', customer: 'Sierra Ag Partners', route: 'Modesto, CA → Denver, CO', delivered: 'Aug 30', pod: 'Attached', amount: '$4,120', tagClass: 'tag-green' },
        { id: 'L-40202', customer: 'Bayline Distribution', route: 'Fresno, CA → Portland, OR', delivered: 'Aug 30', pod: 'Attached', amount: '$3,620', tagClass: 'tag-green' },
        { id: 'L-40201', customer: 'Cascade Building Supply', route: 'Redding, CA → Seattle, WA', delivered: 'Aug 29', pod: 'Attached', amount: '$2,760', tagClass: 'tag-green' },
        { id: 'L-40200', customer: 'Sierra Ag Partners', route: 'Modesto, CA → Salt Lake City, UT', delivered: 'Aug 28', pod: 'Missing', amount: '$3,050', tagClass: 'tag-outline' },
        { id: 'L-40199', customer: 'Vantage Home Goods', route: 'Sacramento, CA → Denver, CO', delivered: 'Aug 27', pod: 'Attached', amount: '$4,410', tagClass: 'tag-green' },
      ].map(r1),
    );
    // Runtruck1 UninvoicedTab KPIS (every value equals Runtruck1's, §3.2).
    expect(uninvoicedKpis(res.body.meta.summary)).toEqual([
      { label: 'Loads', value: '11', note: 'Delivered, not yet invoiced' },
      { label: 'Amount waiting', value: '$34,900', note: 'Across 6 customers' },
      { label: 'Missing POD', value: '3', note: 'Cannot invoice until attached' },
      { label: 'Oldest (days)', value: '7', note: 'L-40199 · delivered Aug 27' },
    ]);
  });

  it('pages in SQL and defaults to limit 100', async () => {
    const agent = await t.as('admin');
    const page = await agent.get(`${url}?limit=2&offset=1`).expect(200);
    expect((page.body.data as Row[]).map((r) => r.loadNumber)).toEqual([40208, 40207]);
    expect(page.body.meta).toMatchObject({ total: 11, limit: 2, offset: 1, summary: { loadCount: 11 } });
    const beyond = await agent.get(`${url}?offset=50`).expect(200);
    expect(beyond.body.data).toEqual([]);
    expect(beyond.body.meta).toMatchObject({ total: 11, limit: 100, offset: 50 });
  });

  it('searches the Runtruck1 view rows server-side; the summary ignores q', async () => {
    const agent = await t.as('admin');
    const sierra = await agent.get(`${url}?q=SIERRA`).expect(200);
    expect((sierra.body.data as Row[]).map((r) => r.loadNumber)).toEqual([40205, 40200]);
    expect(sierra.body.meta).toMatchObject({ total: 2, summary: { loadCount: 11, amountCents: 3_490_000 } });
    const missing = await agent.get(`${url}?q=missing`).expect(200);
    expect((missing.body.data as Row[]).map((r) => r.loadNumber)).toEqual([40207, 40204, 40200]);
    // Formatted strings, not raw values: "$2,450" and "Aug 27".
    expect((await agent.get(url).query({ q: '$2,450' }).expect(200)).body.data).toHaveLength(1);
    expect(((await agent.get(url).query({ q: 'aug 27' }).expect(200)).body.data as Row[])[0]?.loadNumber).toBe(40199);
    // A UUID is not a view-row field.
    expect((await agent.get(`${url}?q=zzz`).expect(200)).body.meta.total).toBe(0);
  });

  it('validates the query', async () => {
    const agent = await t.as('admin');
    for (const [qs, path] of [
      ['limit=0', 'limit'],
      ['limit=501', 'limit'],
      ['offset=-1', 'offset'],
      ['limit=abc', 'limit'],
      [`q=${'x'.repeat(201)}`, 'q'],
    ] as const) {
      const res = await agent.get(`${url}?${qs}`).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.issues[0].path).toBe(path);
    }
  });

  it('requires a session and billing.view', async () => {
    expect((await request(t.server).get(url).expect(401)).body.error.code).toBe('UNAUTHORIZED');
    for (const user of ['dispatcher', 'driver'] as const) {
      const agent = await t.as(user);
      expect((await agent.get(url).expect(403)).body.error.code).toBe('FORBIDDEN');
    }
    const accounting = await t.as('accounting');
    expect((await accounting.get(url).expect(200)).body.meta.summary.loadCount).toBe(11);
  });

  it("never shows another organization's loads", async () => {
    const other = await t.as('otherAdmin');
    const res = await other.get(`${url}?limit=500`).expect(200);
    // Test Carrier Co's delivered load 50000 is invoiced (INV-9002) and 50001 is in transit.
    expect(res.body.data).toEqual([]);
    expect(res.body.meta).toEqual({
      total: 0,
      limit: 500,
      offset: 0,
      summary: { loadCount: 0, amountCents: 0, customerCount: 0, missingPodCount: 0, oldest: null },
    });
  });
});

describe('GET /invoice-batches', () => {
  const url = '/api/v1/invoice-batches';

  it('returns the seven batches with computed counts and totals (01 C5)', async () => {
    const agent = await t.as('admin');
    const res = await agent.get(`${url}?limit=500`).expect(200);
    const rows = res.body.data as Row[];
    expect(rows.map((r) => [r.batchNumber, r.createdOn, r.sentTo, r.status, r.invoiceCount, r.totalCents])).toEqual([
      [2035, '2026-09-03', 'Northgate Foods', 'ready', 2, 443_000],
      [2034, '2026-09-02', 'Cascade Building Supply', 'ready', 3, 855_000],
      [2033, '2026-09-01', 'TriPoint Capital (factoring)', 'sent', 2, 494_000],
      [2032, '2026-08-29', 'Bayline Distribution', 'sent', 2, 482_000],
      [2031, '2026-08-26', 'Harbor Point Retail', 'sent', 2, 559_000],
      [2030, '2026-08-22', 'TriPoint Capital (factoring)', 'settled', 0, 0],
      [2029, '2026-08-19', 'Northgate Foods', 'settled', 1, 245_000],
    ]);
    expect(rows[2]).toEqual({
      id: expect.any(String),
      batchNumber: 2033,
      createdOn: '2026-09-01',
      status: 'sent',
      recipient: { kind: 'factoring_company', id: expect.any(String), name: 'TriPoint Capital' },
      sentTo: 'TriPoint Capital (factoring)',
      invoiceCount: 2,
      totalCents: 494_000,
    });
    expect(rows[0]?.recipient).toEqual({ kind: 'customer', id: expect.any(String), name: 'Northgate Foods' });
    expect(res.body.meta).toEqual({
      total: 7,
      limit: 500,
      offset: 0,
      summary: { batchCount: 7, invoiceCount: 12, readyCount: 2, readyTotalCents: 1_298_000, sentThisWeekCount: 2, totalCents: 3_078_000 },
    });
  });

  it('renders the Batches rows and KPI tiles through the shared view models (§7.3; D5 figures of §8)', async () => {
    const agent = await t.as('admin');
    const res = await agent.get(`${url}?limit=500`).expect(200);
    // Runtruck1 data/accounting.ts BATCHES; counts and totals computed from the seeded membership (01 C5).
    expect((res.body.data as InvoiceBatchRow[]).map(invoiceBatchViewRow)).toEqual(
      [
        { id: 'B-2035', created: 'Sep 3', invoices: 2, total: '$4,430', sentTo: 'Northgate Foods', status: 'Ready', tagClass: 'tag-accent' },
        { id: 'B-2034', created: 'Sep 2', invoices: 3, total: '$8,550', sentTo: 'Cascade Building Supply', status: 'Ready', tagClass: 'tag-accent' },
        { id: 'B-2033', created: 'Sep 1', invoices: 2, total: '$4,940', sentTo: 'TriPoint Capital (factoring)', status: 'Sent', tagClass: 'tag-accent' },
        { id: 'B-2032', created: 'Aug 29', invoices: 2, total: '$4,820', sentTo: 'Bayline Distribution', status: 'Sent', tagClass: 'tag-accent' },
        { id: 'B-2031', created: 'Aug 26', invoices: 2, total: '$5,590', sentTo: 'Harbor Point Retail', status: 'Sent', tagClass: 'tag-accent' },
        { id: 'B-2030', created: 'Aug 22', invoices: 0, total: '$0', sentTo: 'TriPoint Capital (factoring)', status: 'Settled', tagClass: 'tag-green' },
        { id: 'B-2029', created: 'Aug 19', invoices: 1, total: '$2,450', sentTo: 'Northgate Foods', status: 'Settled', tagClass: 'tag-green' },
      ].map(r1),
    );
    expect(invoiceBatchesKpis(res.body.meta.summary)).toEqual([
      { label: 'Batches', value: '7', note: '12 invoices' },
      { label: 'Ready to send', value: '2', note: '$12,980 to go out' },
      { label: 'Sent this week', value: '2', note: 'Last 7 days' },
      { label: 'Total batched', value: '$30,780', note: 'Ready, sent and settled' },
    ]);
  });

  it('pages and searches (invoices is a number, as in Runtruck1)', async () => {
    const agent = await t.as('admin');
    const page = await agent.get(`${url}?limit=3&offset=5`).expect(200);
    expect((page.body.data as Row[]).map((r) => r.batchNumber)).toEqual([2030, 2029]);
    expect(page.body.meta.total).toBe(7);
    const factoring = await agent.get(`${url}?q=factoring`).expect(200);
    expect((factoring.body.data as Row[]).map((r) => r.batchNumber)).toEqual([2033, 2030]);
    expect(factoring.body.meta).toMatchObject({ total: 2, summary: { batchCount: 7 } });
    const settled = await agent.get(`${url}?q=settled&limit=1`).expect(200);
    expect((settled.body.data as Row[]).map((r) => r.batchNumber)).toEqual([2030]);
    expect(settled.body.meta.total).toBe(2);
  });

  it('validates, authenticates and authorizes', async () => {
    const agent = await t.as('admin');
    expect((await agent.get(`${url}?limit=1000`).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    await request(t.server).get(url).expect(401);
    expect((await (await t.as('dispatcher')).get(url).expect(403)).body.error.code).toBe('FORBIDDEN');
  });

  it("isolates tenants: Test Carrier Co sees only its own batch", async () => {
    const other = await t.as('otherAdmin');
    const res = await other.get(`${url}?limit=500`).expect(200);
    expect((res.body.data as Row[]).map((r) => [r.batchNumber, r.sentTo, r.invoiceCount, r.totalCents])).toEqual([[3001, 'Prairie Goods Co', 1, 150_000]]);
    expect(res.body.meta.summary).toEqual({ batchCount: 1, invoiceCount: 1, readyCount: 1, readyTotalCents: 150_000, sentThisWeekCount: 0, totalCents: 150_000 });
  });
});
