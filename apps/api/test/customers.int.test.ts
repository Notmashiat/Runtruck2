import { customerKpis, toCustomerRow, toTopAccount } from '@runtruck/calculations';
import type { CustomerListItem, CustomerListMeta, CustomerOption, PageMeta } from '@runtruck/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchesQuery } from '../src/common/list/list-query.js';
import { createTestContext, type TestContext } from './helpers.js';

// CRM (docs/api/customers.md §5): GET /customers and GET /customers/options against the
// demo seed, plus authentication, permissions, tenancy and validation.

let t: TestContext;
let admin: Awaited<ReturnType<TestContext['as']>>;
beforeAll(async () => {
  t = await createTestContext();
  admin = await t.as('admin');
});
afterAll(async () => {
  await t.close();
});

interface Envelope<T, M> {
  data: T;
  meta: M;
}

async function get<T, M>(path: string, agent = admin): Promise<Envelope<T, M>> {
  const res = await agent.get(`/api/v1${path}`).expect(200);
  return res.body as Envelope<T, M>;
}

const SUNRIDGE_CUSTOMERS = [
  'Northgate Foods',
  'Bayline Distribution',
  'Cascade Building Supply',
  'Harbor Point Retail',
  'Sierra Ag Partners',
  'Vantage Home Goods',
];

describe('GET /customers', () => {
  it('returns the six accounts in Runtruck1 order with their computed aggregates (customers.md §2.6)', async () => {
    const { data, meta } = await get<CustomerListItem[], CustomerListMeta>('/customers?limit=500');
    expect(
      data.map((c) => [
        c.name,
        c.standing,
        c.paymentTerms,
        c.primaryContact?.fullName,
        c.primaryContact?.email,
        c.loadsYtd,
        c.revenueYtdCents,
        c.onTimePercent,
        c.arBalanceCents,
      ]),
    ).toEqual([
      ['Northgate Foods', 'key_account', 'net_30', 'Dana Ruiz', 'dana@northgate.com', 5, 1_131_000, 100, 198_000],
      ['Bayline Distribution', 'key_account', 'net_30', 'Owen Petrakis', 'ops@bayline.co', 5, 1_480_000, 100, 164_000],
      ['Cascade Building Supply', 'growing', 'net_45', 'Marta Lind', null, 6, 1_713_000, 83, 855_000],
      ['Harbor Point Retail', 'growing', 'net_30', 'Jules Amari', null, 3, 913_000, 100, 218_000],
      ['Sierra Ag Partners', 'at_risk', 'net_60', 'Ben Okafor', 'ben@sierraag.com', 5, 1_820_000, 100, 798_000],
      ['Vantage Home Goods', 'growing', 'net_30', 'Iris Chen', null, 5, 1_303_000, 100, 385_000],
    ]);
    expect(meta).toMatchObject({ total: 6, limit: 500, offset: 0 });
    const { topAccounts, ...summary } = meta.summary;
    expect(summary).toEqual({
      asOf: '2026-09-03',
      ytdStart: '2026-01-01',
      accountCount: 6,
      keyAccountCount: 2,
      atRiskCount: 1,
      revenueYtdCents: 8_360_000,
      top3SharePercent: 60,
      onTimePercent: 97,
      openArCents: 2_618_000,
    });
    expect(topAccounts.map((c) => c.name)).toEqual(['Northgate Foods', 'Bayline Distribution', 'Sierra Ag Partners']);
    expect(topAccounts[2]).toEqual(data[4]);
  });

  it('renders the Runtruck1 CRM strings through the shared view-models (numbers differ, D5)', async () => {
    const { data, meta } = await get<CustomerListItem[], CustomerListMeta>('/customers?limit=500');
    expect(
      data
        .map((c) => toCustomerRow(c))
        .map(({ name, contact, loads, revenue, onTime, terms, ar, tier }) => [name, contact, loads, revenue, onTime, terms, ar, tier]),
    ).toEqual([
      ['Northgate Foods', 'Dana Ruiz', '5', '$11K', '100%', 'Net 30', '$1,980', 'Key account'],
      ['Bayline Distribution', 'Owen Petrakis', '5', '$15K', '100%', 'Net 30', '$1,640', 'Key account'],
      ['Cascade Building Supply', 'Marta Lind', '6', '$17K', '83%', 'Net 45', '$8,550', 'Growing'],
      ['Harbor Point Retail', 'Jules Amari', '3', '$9K', '100%', 'Net 30', '$2,180', 'Growing'],
      ['Sierra Ag Partners', 'Ben Okafor', '5', '$18K', '100%', 'Net 60', '$7,980', 'At risk'],
      ['Vantage Home Goods', 'Iris Chen', '5', '$13K', '100%', 'Net 30', '$3,850', 'Growing'],
    ]);
    // Top-account cards (Runtruck1 184/$412K/96%, 151/$338K/94%, 62/$154K/82%; D5).
    expect(meta.summary.topAccounts.map((c) => toTopAccount(c)).map(({ ref: _ref, ...card }) => card)).toEqual([
      {
        tier: 'Key account',
        name: 'Northgate Foods',
        contact: 'Dana Ruiz · dana@northgate.com',
        loads: '5',
        revenue: '$11K',
        onTime: '100%',
      },
      {
        tier: 'Key account',
        name: 'Bayline Distribution',
        contact: 'Owen Petrakis · ops@bayline.co',
        loads: '5',
        revenue: '$15K',
        onTime: '100%',
      },
      {
        tier: 'At risk',
        name: 'Sierra Ag Partners',
        contact: 'Ben Okafor · ben@sierraag.com',
        loads: '5',
        revenue: '$18K',
        onTime: '100%',
      },
    ]);
    expect(data.map((c) => toCustomerRow(c).ref.tone)).toEqual(['blue', 'blue', 'gray', 'gray', 'amber', 'gray']);
    expect(customerKpis(meta.summary)).toEqual([
      { label: 'Accounts', value: '6', note: '2 key accounts' },
      { label: 'Revenue YTD', value: '$0.1M', note: 'Top 3 accounts = 60%' },
      { label: 'On time', value: '97%', note: 'Weighted by loads' },
      { label: 'Open AR', value: '$26.2K', note: '1 account at risk' },
    ]);
  });

  it('filters q over the Runtruck1 Customer strings; the summary and top accounts ignore q', async () => {
    const all = await get<CustomerListItem[], CustomerListMeta>('/customers?limit=500');
    const net45 = await get<CustomerListItem[], CustomerListMeta>('/customers?q=net%2045');
    expect(net45.data.map((c) => c.name)).toEqual(['Cascade Building Supply']);
    expect(net45.meta.total).toBe(1);
    expect(net45.meta.summary).toEqual(all.meta.summary);
    expect((await get<CustomerListItem[], CustomerListMeta>('/customers?q=AT%20RISK')).data.map((c) => c.name)).toEqual([
      'Sierra Ag Partners',
    ]);
    for (const q of ['$1', '100%', 'key account', 'marta', '83', 'nothing here']) {
      const res = await get<CustomerListItem[], CustomerListMeta>(`/customers?q=${encodeURIComponent(q)}`);
      expect(
        res.data.map((c) => c.name),
        q,
      ).toEqual(all.data.filter((c) => matchesQuery(toCustomerRow(c), q)).map((c) => c.name));
    }
    // The contact e-mail is not a CRM table field, so it is not searched.
    expect((await get<CustomerListItem[], CustomerListMeta>('/customers?q=northgate.com')).meta.total).toBe(0);
  });

  it('pages; total counts every match', async () => {
    const page = await get<CustomerListItem[], CustomerListMeta>('/customers?limit=2&offset=4');
    expect(page.data.map((c) => c.name)).toEqual(['Sierra Ag Partners', 'Vantage Home Goods']);
    expect(page.meta).toMatchObject({ total: 6, limit: 2, offset: 4 });
    expect(page.meta.summary.accountCount).toBe(6);
  });
});

describe('GET /customers/options', () => {
  it('returns the six select options in order, without aggregates', async () => {
    const { data, meta } = await get<CustomerOption[], PageMeta>('/customers/options');
    expect(data.map((o) => [o.name, o.paymentTerms])).toEqual([
      ['Northgate Foods', 'net_30'],
      ['Bayline Distribution', 'net_30'],
      ['Cascade Building Supply', 'net_45'],
      ['Harbor Point Retail', 'net_30'],
      ['Sierra Ag Partners', 'net_60'],
      ['Vantage Home Goods', 'net_30'],
    ]);
    expect(Object.keys(data[0] ?? {}).sort()).toEqual(['id', 'name', 'paymentTerms']);
    expect(meta).toEqual({ total: 6, limit: 500, offset: 0 });
  });

  it('matches q against the name, literally, and pages in SQL', async () => {
    expect((await get<CustomerOption[], PageMeta>('/customers/options?q=HARBOR')).data.map((o) => o.name)).toEqual(['Harbor Point Retail']);
    expect((await get<CustomerOption[], PageMeta>('/customers/options?q=%25')).data).toEqual([]);
    expect((await get<CustomerOption[], PageMeta>('/customers/options?q=_')).data).toEqual([]);
    const page = await get<CustomerOption[], PageMeta>('/customers/options?limit=2&offset=2');
    expect(page.data.map((o) => o.name)).toEqual(['Cascade Building Supply', 'Harbor Point Retail']);
    expect(page.meta).toEqual({ total: 6, limit: 2, offset: 2 });
    expect(await get<CustomerOption[], PageMeta>('/customers/options?offset=10')).toEqual({
      data: [],
      meta: { total: 6, limit: 500, offset: 10 },
    });
    // The largest offset the schema accepts reaches SQL OFFSET without a database error.
    expect(await get<CustomerOption[], PageMeta>(`/customers/options?offset=${Number.MAX_SAFE_INTEGER}`)).toEqual({
      data: [],
      meta: { total: 6, limit: 500, offset: Number.MAX_SAFE_INTEGER },
    });
    // A backslash is literal too (the ILIKE escape character).
    expect((await get<CustomerOption[], PageMeta>('/customers/options?q=%5C')).data).toEqual([]);
  });
});

describe('customers access control', () => {
  it('requires a session', async () => {
    for (const path of ['/customers', '/customers/options']) {
      const res = await request(t.server).get(`/api/v1${path}`).expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('refuses members without customers.view', async () => {
    const driver = await t.as('driver');
    for (const path of ['/customers', '/customers/options']) {
      const res = await driver.get(`/api/v1${path}`).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    // CU1: customers.view alone covers the aggregates, AR included (a Dispatcher has no billing.view).
    const dispatcher = await t.as('dispatcher');
    const res = await dispatcher.get('/api/v1/customers').expect(200);
    expect((res.body as Envelope<CustomerListItem[], CustomerListMeta>).meta.summary.openArCents).toBe(2_618_000);
  });

  it('shows another organization only its own customers', async () => {
    const other = await t.as('otherAdmin');
    const crm = await get<CustomerListItem[], CustomerListMeta>('/customers?limit=500', other);
    expect(crm.data.map((c) => c.name)).toEqual(['Prairie Goods Co']);
    expect(crm.data.some((c) => SUNRIDGE_CUSTOMERS.includes(c.name))).toBe(false);
    // Test Carrier Co's own records: L-50001 (picked up Sep 3) and the stop-less L-50000
    // (invoiced Aug 20), INV-9001 open.
    expect(crm.data[0]).toMatchObject({
      loadsYtd: 2,
      revenueYtdCents: 270_000,
      onTimePercent: 100,
      arBalanceCents: 150_000,
      primaryContact: { fullName: 'Casey Field' },
    });
    expect(crm.meta.summary).toMatchObject({
      accountCount: 1,
      keyAccountCount: 0,
      atRiskCount: 0,
      revenueYtdCents: 270_000,
      openArCents: 150_000,
      topAccounts: [],
    });
    expect((await get<CustomerListItem[], CustomerListMeta>('/customers?q=northgate', other)).meta.total).toBe(0);

    const options = await get<CustomerOption[], PageMeta>('/customers/options', other);
    expect(options.data.map((o) => o.name)).toEqual(['Prairie Goods Co']);
    expect((await get<CustomerOption[], PageMeta>('/customers/options?q=bayline', other)).data).toEqual([]);
  });
});

describe('customers query validation', () => {
  it.each([
    ['/customers?limit=0', 'limit'],
    ['/customers?limit=501', 'limit'],
    ['/customers?offset=-1', 'offset'],
    [`/customers?q=${'x'.repeat(201)}`, 'q'],
    ['/customers/options?limit=0', 'limit'],
    ['/customers/options?limit=501', 'limit'],
    ['/customers/options?offset=x', 'offset'],
    ['/customers/options?offset=1e20', 'offset'],
    [`/customers/options?q=${'x'.repeat(201)}`, 'q'],
  ])('%s is a 400 naming %s', async (path, param) => {
    const res = await admin.get(`/api/v1${path}`).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.issues.map((i: { path: string }) => i.path)).toContain(param);
  });
});
