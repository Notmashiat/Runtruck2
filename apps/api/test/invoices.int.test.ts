import { arAgingKpis, invoiceViewRow, paidInvoiceViewRow, paidKpis, pastDueKpis } from '@runtruck/calculations';
import type { InvoiceRow } from '@runtruck/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './helpers.js';

// GET /invoices?status=… (docs/api/billing.md §4) against the demo seed, today = 2026-09-03.

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

const url = '/api/v1/invoices';

// A Runtruck1 mock row as the web renders it: tagClass becomes the Tag tone (Runtruck1 Tag.tsx CHIP).
const TONE: Record<string, string> = { 'tag-accent': 'blue', 'tag-neutral': 'gray', 'tag-outline': 'amber', 'tag-green': 'green' };
const r1 = ({ tagClass, ...row }: { tagClass: string } & Record<string, unknown>) => ({ ...row, tone: TONE[tagClass] });

// Runtruck1 ALL_INVOICES rows (data/mock.ts INVOICES + data/accounting.ts INVOICES_EXTRA), verbatim, by id.
const R1_INVOICES = Object.fromEntries(
  [
    { id: 'INV-8841', customer: 'Northgate Foods', load: 'L-40214', issued: 'Sep 1', amount: '$1,980', age: '2 d', status: 'Sent', tagClass: 'tag-accent' },
    { id: 'INV-8840', customer: 'Bayline Distribution', load: 'L-40212', issued: 'Aug 31', amount: '$1,640', age: '3 d', status: 'Sent', tagClass: 'tag-accent' },
    { id: 'INV-8829', customer: 'Cascade Building Supply', load: 'L-40198', issued: 'Aug 16', amount: '$2,880', age: '18 d', status: 'Sent', tagClass: 'tag-accent' },
    { id: 'INV-8824', customer: 'Harbor Point Retail', load: 'L-40191', issued: 'Aug 7', amount: '$3,410', age: '27 d', status: 'Paid', tagClass: 'tag-green' },
    { id: 'INV-8836', customer: 'Sierra Ag Partners', load: 'L-40210', issued: 'Jul 24', amount: '$4,120', age: '41 d', status: 'Overdue', tagClass: 'tag-outline' },
    { id: 'INV-8844', customer: 'Vantage Home Goods', load: 'L-40197', issued: 'Sep 2', amount: '$2,260', age: '1 d', status: 'Sent', tagClass: 'tag-accent' },
    { id: 'INV-8842', customer: 'Cascade Building Supply', load: 'L-40196', issued: 'Sep 1', amount: '$2,760', age: '2 d', status: 'Sent', tagClass: 'tag-accent' },
    { id: 'INV-8839', customer: 'Sierra Ag Partners', load: 'L-40190', issued: 'Aug 29', amount: '$3,050', age: '5 d', status: 'Paid', tagClass: 'tag-green' },
    { id: 'INV-8838', customer: 'Vantage Home Goods', load: 'L-40189', issued: 'Aug 28', amount: '$1,890', age: '6 d', status: 'Paid', tagClass: 'tag-green' },
    { id: 'INV-8830', customer: 'Northgate Foods', load: 'L-40187', issued: 'Aug 18', amount: '$2,450', age: '16 d', status: 'Paid', tagClass: 'tag-green' },
    { id: 'INV-8823', customer: 'Bayline Distribution', load: 'L-40183', issued: 'Aug 5', amount: '$3,180', age: '29 d', status: 'Paid', tagClass: 'tag-green' },
    { id: 'INV-8821', customer: 'Harbor Point Retail', load: 'L-40178', issued: 'Jul 29', amount: '$2,180', age: '36 d', status: 'Overdue', tagClass: 'tag-outline' },
    { id: 'INV-8819', customer: 'Cascade Building Supply', load: 'L-40176', issued: 'Jul 15', amount: '$2,910', age: '50 d', status: 'Overdue', tagClass: 'tag-outline' },
    { id: 'INV-8815', customer: 'Vantage Home Goods', load: 'L-40172', issued: 'Jul 2', amount: '$1,590', age: '63 d', status: 'Overdue', tagClass: 'tag-outline' },
    { id: 'INV-8811', customer: 'Sierra Ag Partners', load: 'L-40168', issued: 'Jun 28', amount: '$3,860', age: '67 d', status: 'Overdue', tagClass: 'tag-outline' },
  ].map((row) => [row.id, row]),
);
const r1Invoice = (id: string) => {
  const row = R1_INVOICES[id];
  if (!row) throw new Error(`No Runtruck1 invoice ${id}`);
  return row;
};

describe('GET /invoices?status=sent (Invoiced)', () => {
  it('lists open invoices newest first with the computed AR aging', async () => {
    const agent = await t.as('admin');
    const res = await agent.get(`${url}?status=sent&limit=500`).expect(200);
    const rows = res.body.data as Row[];
    expect(rows.map((r) => [r.invoiceNumber, r.customerName, r.loadNumber, r.issuedOn, r.amountCents, r.ageDays])).toEqual([
      [8844, 'Vantage Home Goods', 40197, '2026-09-02', 226_000, 1],
      [8841, 'Northgate Foods', 40214, '2026-09-01', 198_000, 2],
      [8842, 'Cascade Building Supply', 40196, '2026-09-01', 276_000, 2],
      [8840, 'Bayline Distribution', 40212, '2026-08-31', 164_000, 3],
      [8829, 'Cascade Building Supply', 40198, '2026-08-16', 288_000, 18],
    ]);
    expect(rows[0]).toEqual({
      id: expect.any(String),
      invoiceNumber: 8844,
      customerId: expect.any(String),
      customerName: 'Vantage Home Goods',
      loadId: expect.any(String),
      loadNumber: 40197,
      status: 'sent',
      issuedOn: '2026-09-02',
      dueOn: '2026-10-02',
      ageDays: 1,
      daysPastDue: -29,
      amountCents: 226_000,
      paidCents: 0,
      outstandingCents: 226_000,
      latestPayment: null,
      daysToPay: null,
    });
    expect(res.body.meta).toEqual({
      total: 5,
      limit: 500,
      offset: 0,
      summary: {
        status: 'sent',
        arAging: {
          current: { invoiceCount: 5, amountCents: 1_152_000 },
          days1To30: { invoiceCount: 4, amountCents: 1_307_000 },
          days31To60: { invoiceCount: 1, amountCents: 159_000 },
          days60Plus: { invoiceCount: 0, amountCents: 0 },
        },
      },
    });
  });

  it("renders Runtruck1's OPEN rows through the shared view models; the AR tiles are computed (§7.2, D5)", async () => {
    const agent = await t.as('admin');
    const res = await agent.get(`${url}?status=sent&limit=500`).expect(200);
    // Runtruck1 InvoicedTab OPEN order: stable sort by age.
    expect((res.body.data as InvoiceRow[]).map(invoiceViewRow)).toEqual(['INV-8844', 'INV-8841', 'INV-8842', 'INV-8840', 'INV-8829'].map((id) => r1(r1Invoice(id))));
    expect(arAgingKpis(res.body.meta.summary.arAging)).toEqual([
      { label: 'Current', value: '$11,520', note: '5 invoices' },
      { label: '1–30 days', value: '$13,070', note: '4 invoices' },
      { label: '31–60 days', value: '$1,590', note: '1 invoices' },
      { label: '60+ days', value: '$0', note: '0 invoices · collections' },
    ]);
  });
});

describe('GET /invoices?status=overdue (Past Due)', () => {
  it('lists overdue invoices oldest first with the Past Due summary', async () => {
    const agent = await t.as('admin');
    const res = await agent.get(`${url}?status=overdue&limit=500`).expect(200);
    const rows = res.body.data as Row[];
    expect(rows.map((r) => [r.invoiceNumber, r.customerName, r.loadNumber, r.issuedOn, r.amountCents, r.ageDays, r.status])).toEqual([
      [8811, 'Sierra Ag Partners', 40168, '2026-06-28', 386_000, 67, 'overdue'],
      [8815, 'Vantage Home Goods', 40172, '2026-07-02', 159_000, 63, 'overdue'],
      [8819, 'Cascade Building Supply', 40176, '2026-07-15', 291_000, 50, 'overdue'],
      [8836, 'Sierra Ag Partners', 40210, '2026-07-24', 412_000, 41, 'overdue'],
      [8821, 'Harbor Point Retail', 40178, '2026-07-29', 218_000, 36, 'overdue'],
    ]);
    // INV-8836 carries Net 30 terms (01 C6): due Aug 23, 11 days past due.
    expect(rows[3]).toMatchObject({ dueOn: '2026-08-23', daysPastDue: 11 });
    expect(res.body.meta).toEqual({
      total: 5,
      limit: 500,
      offset: 0,
      summary: {
        status: 'overdue',
        invoiceCount: 5,
        amountCents: 1_466_000,
        inCollectionsCount: 2,
        oldest: { invoiceId: rows[0]?.id, invoiceNumber: 8811, customerName: 'Sierra Ag Partners', ageDays: 67 },
        accountsAffected: 4,
        totalAccounts: 6,
      },
    });
  });

  it("renders Runtruck1's OVERDUE rows and KPI tiles through the shared view models (§7.4)", async () => {
    const agent = await t.as('admin');
    const res = await agent.get(`${url}?status=overdue&limit=500`).expect(200);
    // Runtruck1 PastDueTab OVERDUE order: oldest first.
    expect((res.body.data as InvoiceRow[]).map(invoiceViewRow)).toEqual(['INV-8811', 'INV-8815', 'INV-8819', 'INV-8836', 'INV-8821'].map((id) => r1(r1Invoice(id))));
    expect(pastDueKpis(res.body.meta.summary)).toEqual([
      { label: 'Overdue invoices', value: '5', note: 'Past terms' },
      { label: 'Amount overdue', value: '$14,660', note: '2 in collections (60+ days)' },
      { label: 'Oldest', value: '67 d', note: 'INV-8811 · Sierra Ag Partners' },
      { label: 'Accounts affected', value: '4', note: 'of 6 accounts' },
    ]);
  });

  it('searches the view rows', async () => {
    const agent = await t.as('admin');
    const res = await agent.get(`${url}?status=overdue&q=sierra`).expect(200);
    expect((res.body.data as Row[]).map((r) => r.invoiceNumber)).toEqual([8811, 8836]);
    expect(res.body.meta).toMatchObject({ total: 2, summary: { invoiceCount: 5 } });
  });
});

describe('GET /invoices?status=paid (Paid)', () => {
  it('lists paid invoices most recently paid first, with payments', async () => {
    const agent = await t.as('admin');
    const res = await agent.get(`${url}?status=paid&limit=500`).expect(200);
    const rows = res.body.data as Row[];
    const pay = (r: Row) => r.latestPayment as Row;
    expect(rows.map((r) => [r.invoiceNumber, r.customerName, r.loadNumber, r.issuedOn, pay(r).paidOn, pay(r).method, r.amountCents, r.daysToPay])).toEqual([
      [8823, 'Bayline Distribution', 40183, '2026-08-05', '2026-09-03', 'check', 318_000, 29],
      [8824, 'Harbor Point Retail', 40191, '2026-08-07', '2026-09-02', 'ach', 341_000, 26],
      [8838, 'Vantage Home Goods', 40189, '2026-08-28', '2026-09-02', 'factoring', 189_000, 5],
      [8839, 'Sierra Ag Partners', 40190, '2026-08-29', '2026-09-01', 'factoring', 305_000, 3],
      [8830, 'Northgate Foods', 40187, '2026-08-18', '2026-09-01', 'ach', 245_000, 14],
    ]);
    expect(rows[0]).toMatchObject({ status: 'paid', ageDays: 29, paidCents: 318_000, outstandingCents: 0 });
    expect(pay(rows[0]!)).toEqual({
      paymentId: expect.any(String),
      receivedAt: '2026-09-03T17:00:00.000Z',
      paidOn: '2026-09-03',
      method: 'check',
      factoringCompanyId: null,
      factoringCompanyName: null,
      amountCents: 318_000,
    });
    expect(pay(rows[2]!)).toMatchObject({ method: 'factoring', factoringCompanyId: expect.any(String), factoringCompanyName: 'TriPoint Capital' });
    expect(res.body.meta).toEqual({
      total: 5,
      limit: 500,
      offset: 0,
      summary: {
        status: 'paid',
        monthStart: '2026-09-01',
        paidThisMonthCount: 5,
        collectedThisMonthCents: 1_398_000,
        avgDaysToPay: 15,
        factoredCount: 2,
        factoredCents: 494_000,
        factoringCompanyNames: ['TriPoint Capital'],
      },
    });
  });

  it("renders Runtruck1's PAID rows ({...invoice, paid, via, days}) and KPI tiles through the shared view models (§7.5)", async () => {
    const agent = await t.as('admin');
    const res = await agent.get(`${url}?status=paid&limit=500`).expect(200);
    // Runtruck1 PaidTab: PAYMENTS joined in, most recently paid first; the chip tone is the Via chip's.
    const paid = (id: string, extra: { paid: string; via: string; days: number; tone: string }) => {
      const { tagClass: _statusTag, ...invoice } = r1Invoice(id);
      return { ...invoice, ...extra };
    };
    expect((res.body.data as InvoiceRow[]).map(paidInvoiceViewRow)).toEqual([
      paid('INV-8823', { paid: 'Sep 3', via: 'Check', days: 29, tone: 'gray' }),
      paid('INV-8824', { paid: 'Sep 2', via: 'ACH', days: 26, tone: 'gray' }),
      paid('INV-8838', { paid: 'Sep 2', via: 'Factoring', days: 5, tone: 'blue' }),
      paid('INV-8839', { paid: 'Sep 1', via: 'Factoring', days: 3, tone: 'blue' }),
      paid('INV-8830', { paid: 'Sep 1', via: 'ACH', days: 14, tone: 'gray' }),
    ]);
    expect(paidKpis(res.body.meta.summary)).toEqual([
      { label: 'Paid this month', value: '5', note: 'September' },
      { label: 'Amount', value: '$13,980', note: 'Collected this month' },
      { label: 'Avg days to pay', value: '15', note: 'Issued to paid' },
      { label: 'Paid via factoring', value: '2', note: 'TriPoint Capital · $4,940' },
    ]);
  });

  it("searches Runtruck1's hidden age and status fields", async () => {
    const agent = await t.as('admin');
    expect((await agent.get(`${url}?status=paid&q=paid`).expect(200)).body.meta.total).toBe(5);
    const age = await agent.get(url).query({ status: 'paid', q: '29 d' }).expect(200);
    expect((age.body.data as Row[]).map((r) => r.invoiceNumber)).toEqual([8823]);
    const factoring = await agent.get(`${url}?status=paid&q=factoring&limit=1&offset=1`).expect(200);
    expect((factoring.body.data as Row[]).map((r) => r.invoiceNumber)).toEqual([8839]);
    expect(factoring.body.meta.total).toBe(2);
  });
});

describe('GET /invoices?status=draft', () => {
  it('lists the draft (shown on no screen) with its summary', async () => {
    const agent = await t.as('admin');
    const res = await agent.get(`${url}?status=draft`).expect(200);
    expect(res.body.data).toEqual([
      {
        id: expect.any(String),
        invoiceNumber: 8845,
        customerId: expect.any(String),
        customerName: 'Northgate Foods',
        loadId: expect.any(String),
        loadNumber: 40218,
        status: 'draft',
        issuedOn: null,
        dueOn: null,
        ageDays: null,
        daysPastDue: null,
        amountCents: 245_000,
        paidCents: 0,
        outstandingCents: 245_000,
        latestPayment: null,
        daysToPay: null,
      },
    ]);
    expect(res.body.meta).toEqual({ total: 1, limit: 100, offset: 0, summary: { status: 'draft', invoiceCount: 1, amountCents: 245_000 } });
  });
});

describe('GET /invoices: errors and tenancy', () => {
  it('requires one valid status', async () => {
    const agent = await t.as('admin');
    const missing = await agent.get(url).expect(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
    expect(missing.body.error.issues[0].path).toBe('status');
    expect((await agent.get(`${url}?status=void`).expect(400)).body.error.issues[0].path).toBe('status');
    expect((await agent.get(`${url}?status=sent&limit=0`).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires a session and billing.view', async () => {
    expect((await request(t.server).get(`${url}?status=sent`).expect(401)).body.error.code).toBe('UNAUTHORIZED');
    expect((await (await t.as('dispatcher')).get(`${url}?status=sent`).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await (await t.as('accounting')).get(`${url}?status=paid`).expect(200)).body.meta.total).toBe(5);
  });

  it("never shows or counts another organization's invoices", async () => {
    const other = await t.as('otherAdmin');
    const sent = await other.get(`${url}?status=sent&limit=500`).expect(200);
    expect((sent.body.data as Row[]).map((r) => [r.invoiceNumber, r.customerName])).toEqual([[9001, 'Prairie Goods Co']]);
    expect(sent.body.meta.summary.arAging.current).toEqual({ invoiceCount: 1, amountCents: 150_000 });
    const paid = await other.get(`${url}?status=paid&limit=500`).expect(200);
    expect((paid.body.data as Row[]).map((r) => r.invoiceNumber)).toEqual([9002]);
    expect(paid.body.meta.summary).toMatchObject({ factoringCompanyNames: ['Lone Star Factoring'], collectedThisMonthCents: 120_000 });
    const overdue = await other.get(`${url}?status=overdue`).expect(200);
    expect(overdue.body.data).toEqual([]);
    expect(overdue.body.meta.summary).toEqual({
      status: 'overdue',
      invoiceCount: 0,
      amountCents: 0,
      inCollectionsCount: 0,
      oldest: null,
      accountsAffected: 0,
      totalAccounts: 1,
    });
  });
});
