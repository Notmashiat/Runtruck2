import type { CustomerListItem, CustomerListSummary } from '@runtruck/types';
import { describe, expect, it } from 'vitest';
import { customerKpis, formatTopAccountContact, toCustomerRow, toTopAccount } from './customers.js';

// Seeded rows as GET /customers returns them (docs/api/customers.md §2.6).
const customer = (over: Partial<CustomerListItem>): CustomerListItem => ({
  id: 'c',
  name: 'Northgate Foods',
  standing: 'key_account',
  paymentTerms: 'net_30',
  primaryContact: { id: 'p', fullName: 'Dana Ruiz', email: 'dana@northgate.com' },
  loadsYtd: 5,
  revenueYtdCents: 1_131_000,
  onTimePercent: 100,
  arBalanceCents: 198_000,
  ...over,
});

const SEED: CustomerListItem[] = [
  customer({}),
  customer({
    id: 'c2',
    name: 'Bayline Distribution',
    primaryContact: { id: 'p2', fullName: 'Owen Petrakis', email: 'ops@bayline.co' },
    revenueYtdCents: 1_480_000,
    arBalanceCents: 164_000,
  }),
  customer({
    id: 'c3',
    name: 'Cascade Building Supply',
    standing: 'growing',
    paymentTerms: 'net_45',
    primaryContact: { id: 'p3', fullName: 'Marta Lind', email: null },
    loadsYtd: 6,
    revenueYtdCents: 1_713_000,
    onTimePercent: 83,
    arBalanceCents: 855_000,
  }),
  customer({
    id: 'c4',
    name: 'Harbor Point Retail',
    standing: 'growing',
    primaryContact: { id: 'p4', fullName: 'Jules Amari', email: null },
    loadsYtd: 3,
    revenueYtdCents: 913_000,
    arBalanceCents: 218_000,
  }),
  customer({
    id: 'c5',
    name: 'Sierra Ag Partners',
    standing: 'at_risk',
    paymentTerms: 'net_60',
    primaryContact: { id: 'p5', fullName: 'Ben Okafor', email: 'ben@sierraag.com' },
    revenueYtdCents: 1_820_000,
    arBalanceCents: 798_000,
  }),
  customer({
    id: 'c6',
    name: 'Vantage Home Goods',
    standing: 'growing',
    primaryContact: { id: 'p6', fullName: 'Iris Chen', email: null },
    revenueYtdCents: 1_303_000,
    arBalanceCents: 385_000,
  }),
];

describe('customers view-model', () => {
  it('builds Runtruck1 Customer rows for the seed (numbers differ by D5)', () => {
    expect(SEED.map(toCustomerRow).map(({ ref: _ref, ...row }) => row)).toEqual([
      {
        name: 'Northgate Foods',
        contact: 'Dana Ruiz',
        loads: '5',
        revenue: '$11K',
        onTime: '100%',
        terms: 'Net 30',
        ar: '$1,980',
        tier: 'Key account',
      },
      {
        name: 'Bayline Distribution',
        contact: 'Owen Petrakis',
        loads: '5',
        revenue: '$15K',
        onTime: '100%',
        terms: 'Net 30',
        ar: '$1,640',
        tier: 'Key account',
      },
      {
        name: 'Cascade Building Supply',
        contact: 'Marta Lind',
        loads: '6',
        revenue: '$17K',
        onTime: '83%',
        terms: 'Net 45',
        ar: '$8,550',
        tier: 'Growing',
      },
      {
        name: 'Harbor Point Retail',
        contact: 'Jules Amari',
        loads: '3',
        revenue: '$9K',
        onTime: '100%',
        terms: 'Net 30',
        ar: '$2,180',
        tier: 'Growing',
      },
      {
        name: 'Sierra Ag Partners',
        contact: 'Ben Okafor',
        loads: '5',
        revenue: '$18K',
        onTime: '100%',
        terms: 'Net 60',
        ar: '$7,980',
        tier: 'At risk',
      },
      {
        name: 'Vantage Home Goods',
        contact: 'Iris Chen',
        loads: '5',
        revenue: '$13K',
        onTime: '100%',
        terms: 'Net 30',
        ar: '$3,850',
        tier: 'Growing',
      },
    ]);
  });

  it('maps standing to the chip tone in ref', () => {
    expect(SEED.map((c) => toCustomerRow(c).ref.tone)).toEqual(['blue', 'blue', 'gray', 'gray', 'amber', 'gray']);
  });

  it('renders empty cases as "—" (decision CU3)', () => {
    const row = toCustomerRow(customer({ primaryContact: null, loadsYtd: 0, revenueYtdCents: 0, onTimePercent: null, arBalanceCents: 0 }));
    expect(row).toMatchObject({ contact: '—', loads: '0', revenue: '$0K', onTime: '—', ar: '$0' });
    expect(formatTopAccountContact(null)).toBe('—');
  });

  it('builds the top-account cards', () => {
    expect([SEED[0], SEED[1], SEED[4]].map((c) => toTopAccount(c as CustomerListItem))).toEqual([
      {
        tier: 'Key account',
        name: 'Northgate Foods',
        contact: 'Dana Ruiz · dana@northgate.com',
        loads: '5',
        revenue: '$11K',
        onTime: '100%',
        ref: { id: 'c' },
      },
      {
        tier: 'Key account',
        name: 'Bayline Distribution',
        contact: 'Owen Petrakis · ops@bayline.co',
        loads: '5',
        revenue: '$15K',
        onTime: '100%',
        ref: { id: 'c2' },
      },
      {
        tier: 'At risk',
        name: 'Sierra Ag Partners',
        contact: 'Ben Okafor · ben@sierraag.com',
        loads: '5',
        revenue: '$18K',
        onTime: '100%',
        ref: { id: 'c5' },
      },
    ]);
    expect(toTopAccount(SEED[2] as CustomerListItem).contact).toBe('Marta Lind');
  });

  it('builds the KPI row, and "—" without notes while pending', () => {
    const summary: CustomerListSummary = {
      asOf: '2026-09-03',
      ytdStart: '2026-01-01',
      accountCount: 6,
      keyAccountCount: 2,
      atRiskCount: 1,
      revenueYtdCents: 8_360_000,
      top3SharePercent: 60,
      onTimePercent: 97,
      openArCents: 2_618_000,
      topAccounts: [],
    };
    expect(customerKpis(summary)).toEqual([
      { label: 'Accounts', value: '6', note: '2 key accounts' },
      { label: 'Revenue YTD', value: '$0.1M', note: 'Top 3 accounts = 60%' },
      { label: 'On time', value: '97%', note: 'Weighted by loads' },
      { label: 'Open AR', value: '$26.2K', note: '1 account at risk' },
    ]);
    expect(customerKpis({ ...summary, onTimePercent: null })[2]?.value).toBe('—');
    expect(customerKpis(undefined)).toEqual([
      { label: 'Accounts', value: '—' },
      { label: 'Revenue YTD', value: '—' },
      { label: 'On time', value: '—' },
      { label: 'Open AR', value: '—' },
    ]);
  });
});
