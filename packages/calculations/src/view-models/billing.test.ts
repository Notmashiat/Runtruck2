import type { InvoiceBatchRow, InvoiceRow, UninvoicedLoadRow } from '@runtruck/types';
import { describe, expect, it } from 'vitest';
import {
  arAgingKpis,
  formatMonthName,
  invoiceBatchesKpis,
  invoiceBatchSentTo,
  invoiceBatchViewRow,
  invoiceViewRow,
  paidInvoiceViewRow,
  paidKpis,
  pastDueKpis,
  uninvoicedKpis,
  uninvoicedViewRow,
} from './billing.js';

// Expected strings are Runtruck1's for the seeded rows (docs/reference/runtruck1/accounting.md §3).

const invoice = (over: Partial<InvoiceRow>): InvoiceRow => ({
  id: '00000000-0000-4000-8000-000000000001',
  invoiceNumber: 8844,
  customerId: '00000000-0000-4000-8000-000000000002',
  customerName: 'Vantage Home Goods',
  loadId: '00000000-0000-4000-8000-000000000003',
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
  ...over,
});

describe('uninvoicedViewRow', () => {
  const row: UninvoicedLoadRow = {
    loadId: '00000000-0000-4000-8000-000000000010',
    loadNumber: 40209,
    customerId: '00000000-0000-4000-8000-000000000011',
    customerName: 'Northgate Foods',
    route: 'Fresno, CA → Reno, NV',
    deliveredOn: '2026-09-02',
    podStatus: 'attached',
    amountCents: 245_000,
  };

  it('reproduces Runtruck1 UNINVOICED[0] without a UUID', () => {
    expect(uninvoicedViewRow(row)).toEqual({
      id: 'L-40209',
      customer: 'Northgate Foods',
      route: 'Fresno, CA → Reno, NV',
      delivered: 'Sep 2',
      pod: 'Attached',
      amount: '$2,450',
      tone: 'green',
    });
  });

  it('marks a missing POD amber and dashes a load without stops', () => {
    expect(uninvoicedViewRow({ ...row, podStatus: 'missing', route: null, deliveredOn: null })).toMatchObject({
      pod: 'Missing',
      tone: 'amber',
      route: '—',
      delivered: '—',
    });
  });
});

describe('invoiceViewRow', () => {
  it('reproduces an Invoiced row', () => {
    expect(invoiceViewRow(invoice({}))).toEqual({
      id: 'INV-8844',
      customer: 'Vantage Home Goods',
      load: 'L-40197',
      issued: 'Sep 2',
      amount: '$2,260',
      age: '1 d',
      status: 'Sent',
      tone: 'blue',
    });
  });

  it('reproduces a Past Due row', () => {
    const row = invoice({ invoiceNumber: 8811, customerName: 'Sierra Ag Partners', loadNumber: 40168, status: 'overdue', issuedOn: '2026-06-28', ageDays: 67, amountCents: 386_000 });
    expect(invoiceViewRow(row)).toEqual({
      id: 'INV-8811',
      customer: 'Sierra Ag Partners',
      load: 'L-40168',
      issued: 'Jun 28',
      amount: '$3,860',
      age: '67 d',
      status: 'Overdue',
      tone: 'amber',
    });
  });

  it('dashes a draft (no issue date, no load)', () => {
    expect(invoiceViewRow(invoice({ status: 'draft', issuedOn: null, dueOn: null, ageDays: null, loadId: null, loadNumber: null }))).toMatchObject({
      issued: '—',
      age: '—',
      load: '—',
      status: 'Draft',
      tone: 'amber',
    });
  });
});

describe('paidInvoiceViewRow', () => {
  const paid = invoice({
    invoiceNumber: 8823,
    customerName: 'Bayline Distribution',
    loadNumber: 40183,
    status: 'paid',
    issuedOn: '2026-08-05',
    ageDays: 29,
    amountCents: 318_000,
    paidCents: 318_000,
    outstandingCents: 0,
    daysToPay: 29,
    latestPayment: {
      paymentId: '00000000-0000-4000-8000-000000000020',
      receivedAt: '2026-09-03T17:00:00.000Z',
      paidOn: '2026-09-03',
      method: 'check',
      factoringCompanyId: null,
      factoringCompanyName: null,
      amountCents: 318_000,
    },
  });

  it("reproduces Runtruck1's {...invoice, paid, via, days}", () => {
    expect(paidInvoiceViewRow(paid)).toEqual({
      id: 'INV-8823',
      customer: 'Bayline Distribution',
      load: 'L-40183',
      issued: 'Aug 5',
      amount: '$3,180',
      age: '29 d',
      status: 'Paid',
      paid: 'Sep 3',
      via: 'Check',
      days: 29,
      tone: 'gray',
    });
  });

  it('tones factoring blue', () => {
    const factored = paidInvoiceViewRow({ ...paid, latestPayment: { ...paid.latestPayment!, method: 'factoring' } });
    expect(factored).toMatchObject({ via: 'Factoring', tone: 'blue' });
  });

  it('shows a paid invoice without a payment as —, —, 0 days', () => {
    expect(paidInvoiceViewRow({ ...paid, latestPayment: null, daysToPay: null })).toMatchObject({ paid: '—', via: '—', days: 0, tone: 'gray' });
  });
});

describe('invoiceBatchViewRow', () => {
  const batch: InvoiceBatchRow = {
    id: '00000000-0000-4000-8000-000000000030',
    batchNumber: 2033,
    createdOn: '2026-09-01',
    status: 'sent',
    recipient: { kind: 'factoring_company', id: '00000000-0000-4000-8000-000000000031', name: 'TriPoint Capital' },
    sentTo: 'TriPoint Capital (factoring)',
    invoiceCount: 2,
    totalCents: 494_000,
  };

  it('reproduces B-2033 with a numeric invoice count', () => {
    expect(invoiceBatchViewRow(batch)).toEqual({
      id: 'B-2033',
      created: 'Sep 1',
      invoices: 2,
      total: '$4,940',
      sentTo: 'TriPoint Capital (factoring)',
      status: 'Sent',
      tone: 'blue',
    });
    expect(invoiceBatchViewRow({ ...batch, status: 'settled' })).toMatchObject({ status: 'Settled', tone: 'green' });
    expect(invoiceBatchViewRow({ ...batch, status: 'ready' })).toMatchObject({ status: 'Ready', tone: 'blue' });
  });

  it('composes Sent to', () => {
    expect(invoiceBatchSentTo('factoring_company', 'TriPoint Capital')).toBe('TriPoint Capital (factoring)');
    expect(invoiceBatchSentTo('customer', 'Northgate Foods')).toBe('Northgate Foods');
  });
});

describe('KPI tiles', () => {
  it('Uninvoiced', () => {
    expect(
      uninvoicedKpis({
        loadCount: 11,
        amountCents: 3_490_000,
        customerCount: 6,
        missingPodCount: 3,
        oldest: { loadId: 'x', loadNumber: 40199, deliveredOn: '2026-08-27', ageDays: 7 },
      }),
    ).toEqual([
      { label: 'Loads', value: '11', note: 'Delivered, not yet invoiced' },
      { label: 'Amount waiting', value: '$34,900', note: 'Across 6 customers' },
      { label: 'Missing POD', value: '3', note: 'Cannot invoice until attached' },
      { label: 'Oldest (days)', value: '7', note: 'L-40199 · delivered Aug 27' },
    ]);
  });

  it('Uninvoiced with an empty list does not crash (01 C47)', () => {
    const tiles = uninvoicedKpis({ loadCount: 0, amountCents: 0, customerCount: 0, missingPodCount: 0, oldest: null });
    expect(tiles[3]).toEqual({ label: 'Oldest (days)', value: '—', note: 'None' });
  });

  it('pending tiles keep labels, show — and no note', () => {
    expect(uninvoicedKpis(undefined)).toEqual([
      { label: 'Loads', value: '—' },
      { label: 'Amount waiting', value: '—' },
      { label: 'Missing POD', value: '—' },
      { label: 'Oldest (days)', value: '—' },
    ]);
    for (const tiles of [arAgingKpis(undefined), invoiceBatchesKpis(undefined), pastDueKpis(undefined), paidKpis(undefined)]) {
      expect(tiles).toHaveLength(4);
      expect(tiles.every((t) => t.value === '—' && t.note === undefined)).toBe(true);
    }
  });

  it('Invoiced AR aging (computed seed values, D5)', () => {
    expect(
      arAgingKpis({
        current: { invoiceCount: 5, amountCents: 1_152_000 },
        days1To30: { invoiceCount: 4, amountCents: 1_307_000 },
        days31To60: { invoiceCount: 1, amountCents: 159_000 },
        days60Plus: { invoiceCount: 0, amountCents: 0 },
      }),
    ).toEqual([
      { label: 'Current', value: '$11,520', note: '5 invoices' },
      { label: '1–30 days', value: '$13,070', note: '4 invoices' },
      { label: '31–60 days', value: '$1,590', note: '1 invoices' },
      { label: '60+ days', value: '$0', note: '0 invoices · collections' },
    ]);
  });

  it('Batches', () => {
    expect(
      invoiceBatchesKpis({ batchCount: 7, invoiceCount: 12, readyCount: 2, readyTotalCents: 1_298_000, sentThisWeekCount: 2, totalCents: 3_078_000 }),
    ).toEqual([
      { label: 'Batches', value: '7', note: '12 invoices' },
      { label: 'Ready to send', value: '2', note: '$12,980 to go out' },
      { label: 'Sent this week', value: '2', note: 'Last 7 days' },
      { label: 'Total batched', value: '$30,780', note: 'Ready, sent and settled' },
    ]);
  });

  it('Past Due', () => {
    expect(
      pastDueKpis({
        status: 'overdue',
        invoiceCount: 5,
        amountCents: 1_466_000,
        inCollectionsCount: 2,
        oldest: { invoiceId: 'x', invoiceNumber: 8811, customerName: 'Sierra Ag Partners', ageDays: 67 },
        accountsAffected: 4,
        totalAccounts: 6,
      }),
    ).toEqual([
      { label: 'Overdue invoices', value: '5', note: 'Past terms' },
      { label: 'Amount overdue', value: '$14,660', note: '2 in collections (60+ days)' },
      { label: 'Oldest', value: '67 d', note: 'INV-8811 · Sierra Ag Partners' },
      { label: 'Accounts affected', value: '4', note: 'of 6 accounts' },
    ]);
    const empty = pastDueKpis({ status: 'overdue', invoiceCount: 0, amountCents: 0, inCollectionsCount: 0, oldest: null, accountsAffected: 0, totalAccounts: 6 });
    expect(empty[2]).toEqual({ label: 'Oldest', value: '—', note: 'None' });
  });

  it('Paid', () => {
    const summary = {
      status: 'paid' as const,
      monthStart: '2026-09-01',
      paidThisMonthCount: 5,
      collectedThisMonthCents: 1_398_000,
      avgDaysToPay: 15,
      factoredCount: 2,
      factoredCents: 494_000,
      factoringCompanyNames: ['TriPoint Capital'],
    };
    expect(paidKpis(summary)).toEqual([
      { label: 'Paid this month', value: '5', note: 'September' },
      { label: 'Amount', value: '$13,980', note: 'Collected this month' },
      { label: 'Avg days to pay', value: '15', note: 'Issued to paid' },
      { label: 'Paid via factoring', value: '2', note: 'TriPoint Capital · $4,940' },
    ]);
    expect(paidKpis({ ...summary, factoredCount: 0, factoredCents: 0, factoringCompanyNames: [] })[3]?.note).toBe('— · $0');
  });

  it('formats month names', () => {
    expect(formatMonthName('2026-09-01')).toBe('September');
    expect(formatMonthName('2026-01-31')).toBe('January');
    expect(formatMonthName('2026-12-01')).toBe('December');
  });
});
