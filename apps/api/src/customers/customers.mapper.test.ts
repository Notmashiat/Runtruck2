import type { CustomerListItem } from '@runtruck/types';
import { describe, expect, it } from 'vitest';
import {
  type CustomerRecord,
  onTimePercent,
  selectTopAccounts,
  summarizeCustomers,
  toCustomerRecord,
  top3SharePercent,
} from './customers.mapper.js';
import { likeContains } from './customers.repository.js';

const item = (
  id: string,
  standing: CustomerListItem['standing'],
  revenueYtdCents: number,
  loadsYtd = 5,
  arBalanceCents = 0,
): CustomerListItem => ({
  id,
  name: id,
  standing,
  paymentTerms: 'net_30',
  primaryContact: null,
  loadsYtd,
  revenueYtdCents,
  onTimePercent: onTimePercent(loadsYtd, 0),
  arBalanceCents,
});

describe('onTimePercent', () => {
  it('rounds the on-time share and is null without loads', () => {
    expect(onTimePercent(6, 1)).toBe(83);
    expect(onTimePercent(29, 1)).toBe(97);
    expect(onTimePercent(2, 1)).toBe(50);
    expect(onTimePercent(0, 0)).toBeNull();
  });
});

describe('toCustomerRecord', () => {
  it('maps a CRM row, converting bigint sums', () => {
    const record = toCustomerRecord({
      id: 'c',
      name: 'Cascade Building Supply',
      standing: 'growing',
      payment_terms: 'net_45',
      contact_id: 'p',
      contact_name: 'Marta Lind',
      contact_email: null,
      loads_ytd: 6,
      revenue_ytd: '1713000',
      late_ytd: 1,
      ar_balance: '855000',
    });
    expect(record).toEqual({
      lateYtd: 1,
      item: {
        id: 'c',
        name: 'Cascade Building Supply',
        standing: 'growing',
        paymentTerms: 'net_45',
        primaryContact: { id: 'p', fullName: 'Marta Lind', email: null },
        loadsYtd: 6,
        revenueYtdCents: 1713000,
        onTimePercent: 83,
        arBalanceCents: 855000,
      },
    });
  });
});

describe('top accounts and top-3 share (customers.md §2.3)', () => {
  const seed = [
    item('Northgate', 'key_account', 1_131_000),
    item('Bayline', 'key_account', 1_480_000),
    item('Cascade', 'growing', 1_713_000),
    item('Harbor', 'growing', 913_000),
    item('Sierra', 'at_risk', 1_820_000),
    item('Vantage', 'growing', 1_303_000),
  ];

  it('picks key accounts, then at-risk accounts, by position; first three', () => {
    expect(selectTopAccounts(seed).map((c) => c.id)).toEqual(['Northgate', 'Bayline', 'Sierra']);
    expect(selectTopAccounts([item('A', 'at_risk', 0), item('B', 'key_account', 0), item('C', 'growing', 0)]).map((c) => c.id)).toEqual([
      'B',
      'A',
    ]);
    const many = ['k1', 'k2', 'k3', 'k4'].map((id) => item(id, 'key_account', 0));
    expect(selectTopAccounts([item('r', 'at_risk', 0), ...many]).map((c) => c.id)).toEqual(['k1', 'k2', 'k3']);
  });

  it('uses the three largest revenues for the share', () => {
    // Sierra + Cascade + Bayline = 5,013,000 of 8,360,000.
    expect(top3SharePercent(seed)).toBe(60);
    expect(top3SharePercent([])).toBe(0);
    expect(top3SharePercent([item('a', 'growing', 0)])).toBe(0);
  });

  it('breaks revenue ties by position', () => {
    const tied = [
      item('first', 'growing', 100),
      item('second', 'growing', 100),
      item('third', 'growing', 100),
      item('fourth', 'growing', 100),
      item('big', 'growing', 400),
    ];
    // big + the first two by position = 600 of 800.
    expect(top3SharePercent(tied)).toBe(75);
  });

  it('summarizes every customer, on-time weighted by loads', () => {
    const records: CustomerRecord[] = seed.map((c) => ({ item: { ...c, arBalanceCents: 100 }, lateYtd: c.id === 'Cascade' ? 1 : 0 }));
    records[2] = { item: { ...(records[2] as CustomerRecord).item, loadsYtd: 6 }, lateYtd: 1 };
    records[3] = { item: { ...(records[3] as CustomerRecord).item, loadsYtd: 3 }, lateYtd: 0 };
    const summary = summarizeCustomers(records, { asOf: '2026-09-03', ytdStart: '2026-01-01' });
    expect(summary).toMatchObject({
      asOf: '2026-09-03',
      ytdStart: '2026-01-01',
      accountCount: 6,
      keyAccountCount: 2,
      atRiskCount: 1,
      revenueYtdCents: 8_360_000,
      top3SharePercent: 60,
      onTimePercent: 97,
      openArCents: 600,
    });
    expect(summary.topAccounts.map((c) => c.id)).toEqual(['Northgate', 'Bayline', 'Sierra']);
    expect(summarizeCustomers([], { asOf: '2026-09-03', ytdStart: '2026-01-01' })).toMatchObject({
      accountCount: 0,
      revenueYtdCents: 0,
      top3SharePercent: 0,
      onTimePercent: null,
      openArCents: 0,
      topAccounts: [],
    });
  });
});

describe('likeContains', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(likeContains('Net 45')).toBe('%Net 45%');
    expect(likeContains('100%_\\')).toBe('%100\\%\\_\\\\%');
  });
});
