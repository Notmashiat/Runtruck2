import { billsKpis, billViewRow } from '@runtruck/calculations';
import type { BillRow } from '@runtruck/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './helpers.js';

// GET /bills (docs/api/payables.md §2) against the demo seed, today = 2026-09-03.

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

const url = '/api/v1/bills';

describe('GET /bills', () => {
  it("returns Runtruck1's eight bills in due order with the §2.2 summary", async () => {
    const agent = await t.as('admin');
    const res = await agent.get(`${url}?limit=500`).expect(200);
    const rows = res.body.data as Row[];
    expect(rows.map((r) => [r.vendorName, r.categoryLabel, r.dueOn, r.amountCents, r.status])).toEqual([
      ['Verizon Connect ELD', 'Telematics', '2026-08-28', 48_600, 'overdue'],
      ['Modesto Yard — Lease', 'Facilities', '2026-09-01', 390_000, 'paid'],
      ['Comdata', 'Fuel card fees', '2026-09-02', 21_500, 'paid'],
      ['Bridgestone Commercial', 'Tires', '2026-09-04', 238_000, 'due'],
      ['Pilot Flying J', 'Fuel', '2026-09-05', 864_000, 'due'],
      ['Valley Diesel & Turbo', 'Parts · T-118 turbo', '2026-09-08', 398_000, 'due'],
      ['Great West Casualty', 'Insurance', '2026-09-10', 621_000, 'scheduled'],
      ['Ryder Trailer Lease', 'Equipment lease', '2026-09-15', 415_000, 'scheduled'],
    ]);
    expect(rows[5]).toEqual({
      id: expect.any(String),
      vendorId: expect.any(String),
      vendorName: 'Valley Diesel & Turbo',
      category: 'Parts',
      description: 'T-118 turbo',
      categoryLabel: 'Parts · T-118 turbo',
      dueOn: '2026-09-08',
      amountCents: 398_000,
      status: 'due',
      scheduledOn: null,
      paidOn: null,
    });
    expect(rows[1]).toMatchObject({ paidOn: '2026-09-01', scheduledOn: null });
    expect(rows[6]).toMatchObject({ scheduledOn: '2026-09-10', paidOn: null });
    expect(res.body.meta).toEqual({
      total: 8,
      limit: 500,
      offset: 0,
      summary: {
        dueThisWeek: { count: 3, amountCents: 1_500_000 },
        overdue: { count: 1, amountCents: 48_600 },
        scheduled: { count: 2, amountCents: 1_036_000 },
        paidThisMonth: { count: 2, amountCents: 411_500 },
      },
    });
  });

  it("renders exactly Runtruck1's BILLS rows and KPI tiles through the shared view models (§4)", async () => {
    const agent = await t.as('admin');
    const res = await agent.get(`${url}?limit=500`).expect(200);
    const TONE: Record<string, string> = { 'tag-accent': 'blue', 'tag-outline': 'amber', 'tag-green': 'green' };
    // Runtruck1 data/accounting.ts BILLS, verbatim (tagClass → Tag tone).
    expect((res.body.data as BillRow[]).map(billViewRow)).toEqual(
      [
        { vendor: 'Verizon Connect ELD', category: 'Telematics', due: 'Aug 28', amount: '$486', status: 'Overdue', tagClass: 'tag-outline' },
        { vendor: 'Modesto Yard — Lease', category: 'Facilities', due: 'Sep 1', amount: '$3,900', status: 'Paid', tagClass: 'tag-green' },
        { vendor: 'Comdata', category: 'Fuel card fees', due: 'Sep 2', amount: '$215', status: 'Paid', tagClass: 'tag-green' },
        { vendor: 'Bridgestone Commercial', category: 'Tires', due: 'Sep 4', amount: '$2,380', status: 'Due', tagClass: 'tag-outline' },
        { vendor: 'Pilot Flying J', category: 'Fuel', due: 'Sep 5', amount: '$8,640', status: 'Due', tagClass: 'tag-outline' },
        { vendor: 'Valley Diesel & Turbo', category: 'Parts · T-118 turbo', due: 'Sep 8', amount: '$3,980', status: 'Due', tagClass: 'tag-outline' },
        { vendor: 'Great West Casualty', category: 'Insurance', due: 'Sep 10', amount: '$6,210', status: 'Scheduled', tagClass: 'tag-accent' },
        { vendor: 'Ryder Trailer Lease', category: 'Equipment lease', due: 'Sep 15', amount: '$4,150', status: 'Scheduled', tagClass: 'tag-accent' },
      ].map(({ tagClass, ...row }) => ({ ...row, tone: TONE[tagClass] })),
    );
    expect(billsKpis(res.body.meta.summary)).toEqual([
      { label: 'Due this week', value: '3', note: '$15,000' },
      { label: 'Overdue', value: '1', note: '$486' },
      { label: 'Scheduled', value: '2', note: '$10,360 · auto-pay' },
      { label: 'Paid this month', value: '2', note: '$4,115' },
    ]);
  });

  it('pages in SQL and searches the view rows', async () => {
    const agent = await t.as('admin');
    const page = await agent.get(`${url}?limit=2&offset=6`).expect(200);
    expect((page.body.data as Row[]).map((r) => r.vendorName)).toEqual(['Great West Casualty', 'Ryder Trailer Lease']);
    expect(page.body.meta.total).toBe(8);
    const turbo = await agent.get(url).query({ q: 't-118' }).expect(200);
    expect((turbo.body.data as Row[]).map((r) => r.vendorName)).toEqual(['Valley Diesel & Turbo']);
    const due = await agent.get(`${url}?q=due`).expect(200);
    // "Due" and "Overdue" labels both contain "due".
    expect(due.body.meta).toMatchObject({ total: 4, summary: { overdue: { count: 1 } } });
    expect((await agent.get(url).query({ q: '$8,640' }).expect(200)).body.meta.total).toBe(1);
  });

  it('validates the query', async () => {
    const agent = await t.as('admin');
    const res = await agent.get(`${url}?offset=-5`).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.issues[0].path).toBe('offset');
  });

  it('requires a session and payables.view (not billing.view)', async () => {
    expect((await request(t.server).get(url).expect(401)).body.error.code).toBe('UNAUTHORIZED');
    expect((await (await t.as('dispatcher')).get(url).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await (await t.as('driver')).get(url).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await (await t.as('accounting')).get(url).expect(200)).body.meta.total).toBe(8);
  });

  it("never shows or sums another organization's bills", async () => {
    const other = await t.as('otherAdmin');
    const res = await other.get(`${url}?limit=500`).expect(200);
    expect((res.body.data as Row[]).map((r) => r.vendorName)).toEqual(['Texas Tire Supply']);
    // Its one bill is due 2026-09-10, 7 days after the pinned today.
    expect(res.body.meta.summary).toEqual({
      dueThisWeek: { count: 1, amountCents: 50_000 },
      overdue: { count: 0, amountCents: 0 },
      scheduled: { count: 0, amountCents: 0 },
      paidThisMonth: { count: 0, amountCents: 0 },
    });
  });
});
