import type { SettlementRow, SettlementsSummary } from '@runtruck/types';
import { describe, expect, it } from 'vitest';
import { payrollCardTitle, payrollKpis, settlementStatusLabel, settlementViewRow } from './settlements.js';

// Expected strings are Runtruck1's SETTLEMENTS rows and Payroll KPIs (accounting.md §3.6).

const row = (over: Partial<SettlementRow>): SettlementRow => ({
  id: '00000000-0000-4000-8000-000000000001',
  driverId: '00000000-0000-4000-8000-000000000002',
  driverName: 'Marcus Hale',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-07',
  payBasis: 'per_mile',
  payRateCents: 62,
  payPercentBp: null,
  payBasisLabel: '$0.62 / mi',
  loadCount: 4,
  miles: 2140,
  grossCents: 132_600,
  deductionsCents: -14_200,
  netCents: 118_400,
  status: 'ready',
  holdReason: null,
  approvedAt: null,
  ...over,
});

const summary: SettlementsSummary = {
  period: { start: '2026-09-01', end: '2026-09-07' },
  driverCount: 5,
  readyCount: 3,
  approvedCount: 0,
  onHoldCount: 1,
  paidCount: 1,
  grossCents: 547_700,
  deductionsCents: -51_200,
  netCents: 496_500,
  allApproved: false,
};

describe('settlementViewRow', () => {
  it('reproduces Marcus Hale', () => {
    expect(settlementViewRow(row({}))).toEqual({
      name: 'Marcus Hale',
      basis: '$0.62 / mi',
      loads: '4',
      miles: '2,140',
      gross: '$1,326',
      ded: '-$142',
      net: '$1,184',
      status: 'Ready',
      tone: 'blue',
    });
  });

  it('reproduces the held, paid and approved rows', () => {
    expect(
      settlementViewRow(row({ driverName: 'Ellis Nakamura', payBasisLabel: '25% of line haul', status: 'on_hold', holdReason: 'fuel', grossCents: 145_500, deductionsCents: -21_000, netCents: 124_500 })),
    ).toMatchObject({ basis: '25% of line haul', status: 'Hold · fuel', tone: 'amber', ded: '-$210', net: '$1,245' });
    expect(settlementViewRow(row({ driverName: 'Ana Cortez', status: 'paid', deductionsCents: 0, grossCents: 68_400, netCents: 68_400 }))).toMatchObject({
      ded: '—',
      status: 'Paid',
      tone: 'green',
    });
    expect(settlementViewRow(row({ status: 'approved', approvedAt: '2026-09-03T17:00:00.000Z' }))).toMatchObject({ status: 'Approved', tone: 'blue' });
    expect(settlementStatusLabel('on_hold', 'fuel')).toBe('Hold · fuel');
  });
});

describe('payroll card and KPIs', () => {
  it('before approval', () => {
    expect(payrollCardTitle(summary.period)).toBe('Driver settlements · week of Sep 1');
    expect(payrollKpis(summary)).toEqual([
      { label: 'Drivers', value: '5', note: '3 ready to approve' },
      { label: 'Gross', value: '$5,477', note: 'Week of Sep 1' },
      { label: 'Deductions', value: '$512', note: 'Fuel advances and escrow' },
      { label: 'Net payable', value: '$4,965', note: 'Awaiting approval' },
    ]);
  });

  it('after approval', () => {
    const tiles = payrollKpis({ ...summary, readyCount: 0, approvedCount: 3, allApproved: true });
    expect(tiles[0]).toEqual({ label: 'Drivers', value: '5', note: 'Approved for payment' });
    expect(tiles[3]).toEqual({ label: 'Net payable', value: '$4,965', note: 'Approved' });
  });

  it('without a period and while pending', () => {
    expect(payrollCardTitle(null)).toBe('Driver settlements · week of —');
    expect(payrollCardTitle(undefined)).toBe('Driver settlements · week of —');
    expect(payrollKpis({ ...summary, period: null })[1]?.note).toBe('Week of —');
    expect(payrollKpis(undefined).every((k) => k.value === '—' && k.note === undefined)).toBe(true);
  });
});
