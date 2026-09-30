import type { BillRow } from '@runtruck/types';
import { describe, expect, it } from 'vitest';
import { billCategoryLabel, billsKpis, billViewRow } from './payables.js';

// Expected strings are Runtruck1's BILLS rows and Bills KPIs (accounting.md §3.7).

const bill = (over: Partial<BillRow>): BillRow => ({
  id: '00000000-0000-4000-8000-000000000001',
  vendorId: '00000000-0000-4000-8000-000000000002',
  vendorName: 'Valley Diesel & Turbo',
  category: 'Parts',
  description: 'T-118 turbo',
  categoryLabel: 'Parts · T-118 turbo',
  dueOn: '2026-09-08',
  amountCents: 398_000,
  status: 'due',
  scheduledOn: null,
  paidOn: null,
  ...over,
});

describe('billViewRow', () => {
  it('reproduces Runtruck1 rows', () => {
    expect(billViewRow(bill({}))).toEqual({
      vendor: 'Valley Diesel & Turbo',
      category: 'Parts · T-118 turbo',
      due: 'Sep 8',
      amount: '$3,980',
      status: 'Due',
      tone: 'amber',
    });
    expect(billViewRow(bill({ vendorName: 'Verizon Connect ELD', category: 'Telematics', description: null, categoryLabel: 'Telematics', dueOn: '2026-08-28', amountCents: 48_600, status: 'overdue' }))).toEqual({
      vendor: 'Verizon Connect ELD',
      category: 'Telematics',
      due: 'Aug 28',
      amount: '$486',
      status: 'Overdue',
      tone: 'amber',
    });
    expect(billViewRow(bill({ status: 'scheduled' }))).toMatchObject({ status: 'Scheduled', tone: 'blue' });
    expect(billViewRow(bill({ status: 'paid' }))).toMatchObject({ status: 'Paid', tone: 'green' });
  });

  it('composes the category label', () => {
    expect(billCategoryLabel('Parts', 'T-118 turbo')).toBe('Parts · T-118 turbo');
    expect(billCategoryLabel('Tires', null)).toBe('Tires');
  });
});

describe('billsKpis', () => {
  it('matches Runtruck1', () => {
    expect(
      billsKpis({
        dueThisWeek: { count: 3, amountCents: 1_500_000 },
        overdue: { count: 1, amountCents: 48_600 },
        scheduled: { count: 2, amountCents: 1_036_000 },
        paidThisMonth: { count: 2, amountCents: 411_500 },
      }),
    ).toEqual([
      { label: 'Due this week', value: '3', note: '$15,000' },
      { label: 'Overdue', value: '1', note: '$486' },
      { label: 'Scheduled', value: '2', note: '$10,360 · auto-pay' },
      { label: 'Paid this month', value: '2', note: '$4,115' },
    ]);
  });

  it('pending tiles', () => {
    expect(billsKpis(undefined).map((k) => [k.label, k.value, k.note])).toEqual([
      ['Due this week', '—', undefined],
      ['Overdue', '—', undefined],
      ['Scheduled', '—', undefined],
      ['Paid this month', '—', undefined],
    ]);
  });
});
