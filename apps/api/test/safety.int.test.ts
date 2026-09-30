import {
  claimKpis,
  driverDocumentKpis,
  toClaimRow,
  toDriverDocumentRow,
  toDriverWatchlistRow,
  toViolationRow,
  toWorkOrderRow,
  violationKpis,
  workOrderKpis,
} from '@runtruck/calculations';
import { hashPassword, schema } from '@runtruck/database';
import type { RoleKey } from '@runtruck/permissions';
import type {
  ClaimRow,
  ClaimsMeta,
  ComplianceReminderRow,
  ComplianceRemindersMeta,
  DriverDocumentRow,
  DriverDocumentsMeta,
  ViolationRow,
  ViolationsMeta,
  WorkOrderRow,
  WorkOrdersMeta,
} from '@runtruck/types';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchesQuery } from '../src/common/list/list-query.js';
import { createTestContext, TEST_PASSWORD, type TestContext } from './helpers.js';

// Safety read views (docs/api/safety.md §9): GET /work-orders, /driver-documents,
// /compliance-reminders, /violations and /claims against the demo seed, plus
// authentication, permissions, tenancy and validation.

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

// A demo-organization member holding one of the organization's default roles (07 §2).
async function memberWithRole(role: RoleKey, memberNumber: string): Promise<typeof admin> {
  const db = t.db.db;
  const org = t.orgs.demoOrganizationId;
  const email = `${role}.safety@sunridgefreight.test`;
  const [roleRow] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(and(eq(schema.roles.organizationId, org), eq(schema.roles.key, role)));
  const [user] = await db
    .insert(schema.users)
    .values({ email, fullName: `Fixture ${role}`, passwordHash: await hashPassword(TEST_PASSWORD) })
    .returning({ id: schema.users.id });
  if (!roleRow || !user) throw new Error(`cannot create a ${role} member`);
  await db.insert(schema.organizationMembers).values({ organizationId: org, userId: user.id, memberNumber, title: role });
  await db.insert(schema.userRoles).values({ organizationId: org, userId: user.id, roleId: roleRow.id });
  const agent = request.agent(t.server);
  await agent.post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD }).expect(200);
  return agent;
}

const workOrders = (path: string, agent = admin) => get<WorkOrderRow[], WorkOrdersMeta>(path, agent);
const documents = (path: string, agent = admin) => get<DriverDocumentRow[], DriverDocumentsMeta>(path, agent);
const reminders = (path: string, agent = admin) => get<ComplianceReminderRow[], ComplianceRemindersMeta>(path, agent);
const violations = (path: string, agent = admin) => get<ViolationRow[], ViolationsMeta>(path, agent);
const claims = (path: string, agent = admin) => get<ClaimRow[], ClaimsMeta>(path, agent);

// A view-model row as its values, the chip tone last (in place of Runtruck1's tagClass).
function vmValues(vm: { ref: { tone: string } }): unknown[] {
  const { ref, ...row } = vm;
  return [...Object.values(row), ref.tone];
}

describe('GET /work-orders', () => {
  it('returns the seeded work orders in Runtruck1 order with the summary (safety.md §2.4–§2.5)', async () => {
    const { data, meta } = await workOrders('/work-orders?limit=500');
    expect(
      data.map((w) => [w.unit.kind, w.unit.unitNumber, w.item, w.dueOn, w.dueOdometer, `${w.shop.name}, ${w.shop.city}`, w.estimateCents, w.status, w.completedOn]),
    ).toEqual([
      ['truck', 'T-118', 'Turbocharger replacement', '2026-09-05', null, 'Sunridge shop, Modesto', 485000, 'in_shop', null],
      ['trailer', 'FB-12', 'DOT annual inspection', '2026-09-03', null, 'Sunridge shop, Modesto', 15000, 'in_shop', null],
      ['truck', 'T-121', 'Brake adjustment', '2026-08-28', null, 'Sunridge shop, Modesto', 42000, 'overdue', null],
      ['truck', 'T-114', 'PM service A', null, 529800, 'Sunridge shop, Modesto', 64000, 'due', null],
      ['trailer', 'RF-27', 'Reefer unit service', '2026-09-12', null, 'Thermo King, Fresno', 71000, 'scheduled', null],
      ['truck', 'T-107', 'DOT annual inspection', '2026-09-18', null, 'Valley Truck Center, Stockton', 18500, 'scheduled', null],
      ['truck', 'T-103', 'Tire rotation', null, 342000, 'Sunridge shop, Modesto', 16000, 'scheduled', null],
      ['truck', 'T-109', 'DOT annual inspection', '2026-08-22', null, 'Valley Truck Center, Stockton', 18500, 'done', '2026-08-22'],
    ]);
    expect(meta).toMatchObject({ total: 8, limit: 500, offset: 0 });
    expect(meta.summary).toEqual({
      asOf: '2026-09-03',
      doneWindowStart: '2026-08-04',
      workOrderCount: 8,
      openCount: 7,
      doneLast30dCount: 1,
      inShopCount: 2,
      inShopShops: [{ facilityId: data[0]?.shop.facilityId, name: 'Sunridge shop', city: 'Modesto' }],
      overdue: [{ workOrderId: data[2]?.id, unitNumber: 'T-121', item: 'Brake adjustment' }],
      openEstimateCents: 711500,
    });
  });

  it('renders exactly Runtruck1’s MAINTENANCE strings and KPIs (safety.md §7.1)', async () => {
    const { data, meta } = await workOrders('/work-orders?limit=500');
    expect(data.map(toWorkOrderRow).map(vmValues)).toEqual([
      ['T-118', 'Turbocharger replacement', 'Sep 5', 'Sunridge shop · Modesto', 4850, 'In shop', 'amber'],
      ['FB-12', 'DOT annual inspection', 'Sep 3', 'Sunridge shop · Modesto', 150, 'In shop', 'amber'],
      ['T-121', 'Brake adjustment', 'Aug 28', 'Sunridge shop · Modesto', 420, 'Overdue', 'amber'],
      ['T-114', 'PM service A', '529,800 mi', 'Sunridge shop · Modesto', 640, 'Due', 'amber'],
      ['RF-27', 'Reefer unit service', 'Sep 12', 'Thermo King · Fresno', 710, 'Scheduled', 'blue'],
      ['T-107', 'DOT annual inspection', 'Sep 18', 'Valley Truck Center · Stockton', 185, 'Scheduled', 'blue'],
      ['T-103', 'Tire rotation', '342,000 mi', 'Sunridge shop · Modesto', 160, 'Scheduled', 'blue'],
      ['T-109', 'DOT annual inspection', 'Aug 22', 'Valley Truck Center · Stockton', 185, 'Done', 'gray'],
    ]);
    expect(workOrderKpis(meta.summary)).toEqual([
      { label: 'Open work orders', value: '7', note: '1 done · last 30 d' },
      { label: 'In shop', value: '2', note: 'Sunridge shop · Modesto' },
      { label: 'Overdue', value: '1', note: 'T-121 · Brake adjustment' },
      { label: 'Est. cost open', value: '$7,115', note: 'Parts & labor, open orders' },
    ]);
  });

  it('filters q over the view-model (estimate as whole dollars); the summary ignores q', async () => {
    const all = await workOrders('/work-orders?limit=500');
    const units = async (q: string) => (await workOrders(`/work-orders?q=${encodeURIComponent(q)}`)).data.map((w) => w.unit.unitNumber);
    expect(await units('4850')).toEqual(['T-118']);
    expect(await units('$4,850')).toEqual([]);
    expect(await units('485000')).toEqual([]);
    expect(await units('342,000')).toEqual(['T-103']);
    expect(await units('fresno')).toEqual(['RF-27']);
    for (const q of ['4850', '$4,850', '342,000', 'fresno', 'in shop', 'sep 1', 'dot', 'in_shop', 'trailer']) {
      const res = await workOrders(`/work-orders?q=${encodeURIComponent(q)}`);
      const expected = all.data.filter((w) => matchesQuery(toWorkOrderRow(w), q)).map((w) => w.id);
      expect(
        res.data.map((w) => w.id),
        q,
      ).toEqual(expected);
      expect(res.meta.total).toBe(expected.length);
      expect(res.meta.summary).toEqual(all.meta.summary);
    }
    // q combines with status and pages among the matches.
    const q = await workOrders('/work-orders?status=scheduled&q=dot&limit=1');
    expect(q.data.map((w) => w.unit.unitNumber)).toEqual(['T-107']);
    expect(q.meta.total).toBe(1);
  });

  it('filters by status without changing the summary, and pages in SQL', async () => {
    const all = await workOrders('/work-orders');
    const inShop = await workOrders('/work-orders?status=in_shop');
    expect(inShop.data.map((w) => w.unit.unitNumber)).toEqual(['T-118', 'FB-12']);
    expect(inShop.meta.total).toBe(2);
    expect(inShop.meta.summary).toEqual(all.meta.summary);
    const page = await workOrders('/work-orders?limit=3&offset=3');
    expect(page.data.map((w) => w.unit.unitNumber)).toEqual(['T-114', 'RF-27', 'T-107']);
    expect(page.meta).toMatchObject({ total: 8, limit: 3, offset: 3 });
    const beyond = await workOrders('/work-orders?status=in_shop&offset=10');
    expect(beyond.data).toEqual([]);
    expect(beyond.meta.total).toBe(2);
    expect((await workOrders('/work-orders?status=done&q=zzz')).meta.total).toBe(0);
  });
});

describe('GET /driver-documents', () => {
  it('returns the 15 seeded documents in roster order with the summary (safety.md §3.4–§3.5)', async () => {
    const { data, meta } = await documents('/driver-documents?limit=500');
    expect(data.map((d) => [d.driver.fullName, d.documentType, d.expiresOn, d.expiresPrecision, d.status])).toEqual([
      ['Marcus Hale', 'cdl', '2028-04-30', 'month', 'valid'],
      ['Marcus Hale', 'medical_card', '2027-03-31', 'month', 'valid'],
      ['Marcus Hale', 'clearinghouse_query', '2026-09-20', 'day', 'expiring'],
      ['Dara Whitfield', 'cdl', '2027-11-30', 'month', 'valid'],
      ['Dara Whitfield', 'medical_card', '2027-06-30', 'month', 'valid'],
      ['Ellis Nakamura', 'cdl', '2027-02-28', 'month', 'valid'],
      ['Ellis Nakamura', 'medical_card', '2026-10-12', 'day', 'expiring'],
      ['Priya Raman', 'cdl', '2026-07-31', 'month', 'expired'],
      ['Priya Raman', 'medical_card', '2028-01-31', 'month', 'valid'],
      ['Ana Cortez', 'cdl', '2029-09-30', 'month', 'valid'],
      ['Ana Cortez', 'mvr', '2026-09-24', 'day', 'expiring'],
      ['Ana Cortez', 'annual_review', '2026-09-24', 'day', 'expiring'],
      ['Tobias Frey', 'cdl', '2028-01-31', 'month', 'valid'],
      ['Tobias Frey', 'medical_card', '2026-12-31', 'month', 'valid'],
      ['Tobias Frey', 'drug_test', null, 'month', 'missing'],
    ]);
    expect(meta).toMatchObject({ total: 15, limit: 500, offset: 0 });
    expect(meta.summary).toEqual({
      asOf: '2026-09-03',
      expiringWindowEnd: '2026-11-02',
      documentCount: 15,
      driverCount: 6,
      expiringCount: 4,
      expired: [{ driverDocumentId: data[7]?.id, driverId: data[7]?.driver.id, fullName: 'Priya Raman', documentType: 'cdl' }],
      missing: [{ driverDocumentId: data[14]?.id, driverId: data[14]?.driver.id, fullName: 'Tobias Frey', documentType: 'drug_test' }],
    });
  });

  it('renders exactly Runtruck1’s DRIVER_DOCUMENTS strings and KPIs (safety.md §7.2)', async () => {
    const { data, meta } = await documents('/driver-documents?limit=500');
    expect(data.map(toDriverDocumentRow).map(vmValues)).toEqual([
      ['Marcus Hale', 'CDL', 'Apr 2028', 'Valid', 'green'],
      ['Marcus Hale', 'Medical card', 'Mar 2027', 'Valid', 'green'],
      ['Marcus Hale', 'Clearinghouse query', 'Sep 20', 'Expiring', 'amber'],
      ['Dara Whitfield', 'CDL', 'Nov 2027', 'Valid', 'green'],
      ['Dara Whitfield', 'Medical card', 'Jun 2027', 'Valid', 'green'],
      ['Ellis Nakamura', 'CDL', 'Feb 2027', 'Valid', 'green'],
      ['Ellis Nakamura', 'Medical card', 'Oct 12', 'Expiring', 'amber'],
      ['Priya Raman', 'CDL', 'Jul 2026', 'Expired', 'amber'],
      ['Priya Raman', 'Medical card', 'Jan 2028', 'Valid', 'green'],
      ['Ana Cortez', 'CDL', 'Sep 2029', 'Valid', 'green'],
      ['Ana Cortez', 'MVR', 'Sep 24', 'Expiring', 'amber'],
      ['Ana Cortez', 'Annual review', 'Sep 24', 'Expiring', 'amber'],
      ['Tobias Frey', 'CDL', 'Jan 2028', 'Valid', 'green'],
      ['Tobias Frey', 'Medical card', 'Dec 2026', 'Valid', 'green'],
      ['Tobias Frey', 'Drug test', '—', 'Missing', 'amber'],
    ]);
    expect(driverDocumentKpis(meta.summary)).toEqual([
      { label: 'Documents', value: '15', note: '6 drivers on file' },
      { label: 'Expiring (60 d)', value: '4', note: 'Renew before Nov 2' },
      { label: 'Expired', value: '1', note: 'Priya Raman · CDL' },
      { label: 'Missing', value: '1', note: 'Tobias Frey · Drug test' },
    ]);
  });

  it('filters q and status over the view-model; the summary ignores both', async () => {
    const all = await documents('/driver-documents?limit=500');
    const rows = async (q: string) => (await documents(`/driver-documents?q=${encodeURIComponent(q)}`)).data.map((d) => `${d.driver.fullName} ${d.documentType}`);
    expect(await rows('—')).toEqual(['Tobias Frey drug_test']);
    expect(await rows('2026')).toEqual(['Priya Raman cdl', 'Tobias Frey medical_card']);
    expect(await rows('sep 2')).toHaveLength(4);
    for (const q of ['—', '2026', 'sep 2', 'expir', 'medical', 'drug_test']) {
      const res = await documents(`/driver-documents?q=${encodeURIComponent(q)}`);
      expect(
        res.data.map((d) => d.id),
        q,
      ).toEqual(all.data.filter((d) => matchesQuery(toDriverDocumentRow(d), q)).map((d) => d.id));
      expect(res.meta.summary).toEqual(all.meta.summary);
    }
    const expiring = await documents('/driver-documents?status=expiring');
    expect(expiring.meta.total).toBe(4);
    expect(expiring.meta.summary).toEqual(all.meta.summary);
    const page = await documents('/driver-documents?limit=2&offset=14');
    expect(page.data.map((d) => d.documentType)).toEqual(['drug_test']);
    expect(page.meta.total).toBe(15);
  });
});

describe('GET /compliance-reminders', () => {
  it('returns the watchlist in its hand-authored order (safety.md §4.5, §7.3)', async () => {
    const { data, meta } = await reminders('/compliance-reminders?limit=500');
    expect(data.map((r) => [r.driver.fullName, r.itemLabel, r.dueOn, r.duePrecision])).toEqual([
      ['Priya Raman', 'CDL renewal', '2026-07-31', 'month'],
      ['Ellis Nakamura', 'Medical card', '2026-10-12', 'day'],
      ['Ana Cortez', 'Annual MVR review', '2026-09-24', 'day'],
      ['Marcus Hale', 'Clearinghouse query', '2026-09-20', 'day'],
    ]);
    expect(data.map(toDriverWatchlistRow).map(({ ref: _ref, ...row }) => Object.values(row))).toEqual([
      ['Priya Raman', 'CDL renewal', 'Jul 2026'],
      ['Ellis Nakamura', 'Medical card', 'Oct 12'],
      ['Ana Cortez', 'Annual MVR review', 'Sep 24'],
      ['Marcus Hale', 'Clearinghouse query', 'Sep 20'],
    ]);
    // "Docs to renew" = meta.total of the unfiltered request (fleet.md F1).
    expect(meta).toEqual({ total: 4, limit: 500, offset: 0, summary: { asOf: '2026-09-03', reminderCount: 4 } });
  });

  it('filters q over the watch-item view-model and pages', async () => {
    const res = await reminders('/compliance-reminders?q=sep%202');
    expect(res.data.map((r) => r.driver.fullName)).toEqual(['Ana Cortez', 'Marcus Hale']);
    expect(res.meta).toMatchObject({ total: 2, summary: { reminderCount: 4 } });
    const page = await reminders('/compliance-reminders?limit=1&offset=1');
    expect(page.data.map((r) => r.driver.fullName)).toEqual(['Ellis Nakamura']);
    expect(page.meta.total).toBe(4);
  });
});

describe('GET /violations', () => {
  it('returns the seeded violations newest first with the summary (safety.md §5.4–§5.5)', async () => {
    const { data, meta } = await violations('/violations?limit=500');
    expect(data.map((v) => [v.occurredOn, v.driver.fullName, v.truck.unitNumber, v.violationType, v.severityPoints, v.location, v.status])).toEqual([
      ['2026-08-31', 'Tobias Frey', 'T-118', 'Log form & manner', 1, 'I-70 POE · Loma, CO', 'open'],
      ['2026-08-28', 'Ellis Nakamura', 'T-121', 'Brake adjustment', 4, 'I-5 scale · Cottonwood, CA', 'open'],
      ['2026-08-19', 'Marcus Hale', 'T-114', 'Hours-of-service', 7, 'US-95 POE · Winnemucca, NV', 'contested'],
      ['2026-07-30', 'Dara Whitfield', 'T-107', 'Lighting', 6, 'I-80 scale · Donner Pass, CA', 'closed'],
      ['2026-06-12', 'Tobias Frey', 'T-118', 'Speeding 6–10 over', 4, 'I-70 · Grand Junction, CO', 'closed'],
      ['2026-05-06', 'Ellis Nakamura', 'T-121', 'Log form & manner', 1, 'I-84 POE · Ontario, OR', 'closed'],
      ['2026-03-18', 'Ana Cortez', 'T-109', 'Lighting', 6, 'I-5 scale · Ashland, OR', 'closed'],
    ]);
    expect(meta).toMatchObject({ total: 7, limit: 500, offset: 0 });
    expect(meta.summary).toEqual({
      asOf: '2026-09-03',
      pointsWindowStart: '2025-09-04',
      violationCount: 7,
      openCount: 2,
      contestedCount: 1,
      closedCount: 4,
      pointsInWindow: 29,
      violationsInWindowCount: 7,
    });
  });

  it('renders exactly Runtruck1’s VIOLATIONS strings and KPIs (safety.md §7.4)', async () => {
    const { data, meta } = await violations('/violations?limit=500');
    expect(data.map(toViolationRow).map(vmValues)).toEqual([
      ['Aug 31', 'Tobias Frey', 'T-118', 'Log form & manner', 1, 'I-70 POE · Loma, CO', 'Open', 'amber'],
      ['Aug 28', 'Ellis Nakamura', 'T-121', 'Brake adjustment', 4, 'I-5 scale · Cottonwood, CA', 'Open', 'amber'],
      ['Aug 19', 'Marcus Hale', 'T-114', 'Hours-of-service', 7, 'US-95 POE · Winnemucca, NV', 'Contested', 'blue'],
      ['Jul 30', 'Dara Whitfield', 'T-107', 'Lighting', 6, 'I-80 scale · Donner Pass, CA', 'Closed', 'gray'],
      ['Jun 12', 'Tobias Frey', 'T-118', 'Speeding 6–10 over', 4, 'I-70 · Grand Junction, CO', 'Closed', 'gray'],
      ['May 6', 'Ellis Nakamura', 'T-121', 'Log form & manner', 1, 'I-84 POE · Ontario, OR', 'Closed', 'gray'],
      ['Mar 18', 'Ana Cortez', 'T-109', 'Lighting', 6, 'I-5 scale · Ashland, OR', 'Closed', 'gray'],
    ]);
    expect(violationKpis(meta.summary)).toEqual([
      { label: 'Open', value: '2', note: 'Corrective action pending' },
      { label: 'Points (12 mo)', value: '29', note: 'CSA severity · 7 violations' },
      { label: 'Contested', value: '1', note: 'DataQ challenge filed' },
      { label: 'Closed', value: '4', note: 'Resolved, on file' },
    ]);
  });

  it('filters q and status; the summary ignores both', async () => {
    const all = await violations('/violations?limit=500');
    const drivers = async (q: string) => (await violations(`/violations?q=${encodeURIComponent(q)}`)).data.map((v) => `${v.occurredOn} ${v.driver.fullName}`);
    expect(await drivers('cottonwood')).toEqual(['2026-08-28 Ellis Nakamura']);
    expect(await drivers('log form')).toHaveLength(2);
    expect(await drivers('contested')).toEqual(['2026-08-19 Marcus Hale']);
    for (const q of ['cottonwood', 'log form', 'contested', '7', 'aug', 'T-1', '6–10']) {
      const res = await violations(`/violations?q=${encodeURIComponent(q)}`);
      expect(
        res.data.map((v) => v.id),
        q,
      ).toEqual(all.data.filter((v) => matchesQuery(toViolationRow(v), q)).map((v) => v.id));
      expect(res.meta.summary).toEqual(all.meta.summary);
    }
    const closed = await violations('/violations?status=closed');
    expect(closed.meta.total).toBe(4);
    expect(closed.data.map((v) => v.occurredOn)).toEqual(['2026-07-30', '2026-06-12', '2026-05-06', '2026-03-18']);
    expect(closed.meta.summary).toEqual(all.meta.summary);
    const page = await violations('/violations?limit=2&offset=5');
    expect(page.data.map((v) => v.occurredOn)).toEqual(['2026-05-06', '2026-03-18']);
    expect(page.meta.total).toBe(7);
    expect((await violations('/violations?offset=9')).meta).toMatchObject({ total: 7 });
  });
});

describe('GET /claims', () => {
  it('returns the seeded claims newest first with the summary (safety.md §6.4–§6.5)', async () => {
    const { data, meta } = await claims('/claims?limit=500');
    expect(
      data.map((c) => [
        c.claimNumber,
        c.occurredOn,
        c.driver.fullName,
        `${c.truck.unitNumber} / ${c.trailer?.unitNumber ?? ''}`,
        c.claimType,
        c.claimant.kind,
        c.claimant.name,
        c.reservedCents,
        c.paidCents,
        c.status,
        c.load,
      ]),
    ).toEqual([
      [1112, '2026-08-26', 'Ellis Nakamura', 'T-121 / FB-12', 'cargo_damage', 'customer', 'Cascade Building Supply', 680000, 0, 'open', null],
      [1111, '2026-08-14', 'Marcus Hale', 'T-114 / RF-88', 'cargo_damage', 'customer', 'Northgate Foods', 420000, 0, 'under_review', null],
      [1110, '2026-07-22', 'Dara Whitfield', 'T-107 / DV-51', 'property_damage', 'facility', 'Wasatch Crossdock', 290000, 265000, 'settled', null],
      [1109, '2026-06-30', 'Tobias Frey', 'T-118 / DV-14', 'cargo_shortage', 'customer', 'Sierra Ag Partners', 145000, 0, 'denied', null],
      [1108, '2026-05-09', 'Ana Cortez', 'T-109 / FB-04', 'bodily_injury', 'third_party', 'R. Delgado', 2500000, 1850000, 'settled', null],
      [1107, '2026-03-03', 'Priya Raman', 'T-103 / RF-27', 'cargo_damage', 'customer', 'Northgate Foods', 310000, 287500, 'settled', null],
    ]);
    expect(data[4]?.claimant).toEqual({ kind: 'third_party', name: 'R. Delgado' });
    expect(data[2]?.claimant).toMatchObject({ kind: 'facility', facilityId: expect.any(String) });
    expect(data[0]?.claimant).toMatchObject({ kind: 'customer', customerId: expect.any(String) });
    expect(meta).toMatchObject({ total: 6, limit: 500, offset: 0 });
    expect(meta.summary).toEqual({
      asOf: '2026-09-03',
      ytdStart: '2026-01-01',
      claimCount: 6,
      openCount: 2,
      underReviewCount: 1,
      openReservedCents: 1100000,
      paidYtdCents: 2402500,
      paidYtdCount: 3,
      settledCount: 3,
      deniedCount: 1,
    });
  });

  it('renders exactly Runtruck1’s CLAIMS strings and KPIs (safety.md §7.5)', async () => {
    const { data, meta } = await claims('/claims?limit=500');
    expect(data.map(toClaimRow).map(vmValues)).toEqual([
      ['CLM-1112', 'Aug 26', 'Ellis Nakamura', 'T-121 / FB-12', 'Cargo damage', 'Cascade Building Supply', 6800, 0, 'Open', 'amber'],
      ['CLM-1111', 'Aug 14', 'Marcus Hale', 'T-114 / RF-88', 'Cargo damage', 'Northgate Foods', 4200, 0, 'Under review', 'blue'],
      ['CLM-1110', 'Jul 22', 'Dara Whitfield', 'T-107 / DV-51', 'Property damage', 'Wasatch Crossdock', 2900, 2650, 'Settled', 'green'],
      ['CLM-1109', 'Jun 30', 'Tobias Frey', 'T-118 / DV-14', 'Cargo shortage', 'Sierra Ag Partners', 1450, 0, 'Denied', 'gray'],
      ['CLM-1108', 'May 9', 'Ana Cortez', 'T-109 / FB-04', 'Bodily injury', 'Third party · R. Delgado', 25000, 18500, 'Settled', 'green'],
      ['CLM-1107', 'Mar 3', 'Priya Raman', 'T-103 / RF-27', 'Cargo damage', 'Northgate Foods', 3100, 2875, 'Settled', 'green'],
    ]);
    expect(claimKpis(meta.summary)).toEqual([
      { label: 'Open claims', value: '2', note: '1 under review' },
      { label: 'Reserved', value: '$11,000', note: 'On open claims' },
      { label: 'Paid YTD', value: '$24,025', note: '3 settlements' },
      { label: 'Settled', value: '3', note: '1 denied' },
    ]);
  });

  it('filters q (money as whole dollars) and status; the summary ignores both', async () => {
    const all = await claims('/claims?limit=500');
    const numbers = async (q: string) => (await claims(`/claims?q=${encodeURIComponent(q)}`)).data.map((c) => c.claimNumber);
    expect(await numbers('18500')).toEqual([1108]);
    expect(await numbers('$18,500')).toEqual([]);
    expect(await numbers('northgate')).toEqual([1111, 1107]);
    expect(await numbers('third party')).toEqual([1108]);
    for (const q of ['18500', '$18,500', 'northgate', 'third party', '0', 'clm-111', 'under review', 'under_review', '1850000']) {
      const res = await claims(`/claims?q=${encodeURIComponent(q)}`);
      expect(
        res.data.map((c) => c.claimNumber),
        q,
      ).toEqual(all.data.filter((c) => matchesQuery(toClaimRow(c), q)).map((c) => c.claimNumber));
      expect(res.meta.summary).toEqual(all.meta.summary);
    }
    const settled = await claims('/claims?status=settled');
    expect(settled.data.map((c) => c.claimNumber)).toEqual([1110, 1108, 1107]);
    expect(settled.meta.total).toBe(3);
    expect(settled.meta.summary).toEqual(all.meta.summary);
    const page = await claims('/claims?limit=2&offset=2');
    expect(page.data.map((c) => c.claimNumber)).toEqual([1110, 1109]);
    expect(page.meta.total).toBe(6);
  });
});

describe('Safety validation', () => {
  // The paging and search bounds of §1.2 on every endpoint, and the single status filter
  // on the four that have one.
  const PAGING: [string, string][] = [
    ['limit=0', 'limit'],
    ['limit=501', 'limit'],
    ['limit=abc', 'limit'],
    ['offset=-1', 'offset'],
    ['offset=1.5', 'offset'],
    [`q=${'x'.repeat(201)}`, 'q'],
    ['q=a&q=b', 'q'],
  ];
  const STATUS: [string, string][] = [
    ['status=bogus', 'status'],
    ['status=open&status=closed', 'status'],
  ];
  const MATRIX = [
    ...['/work-orders', '/driver-documents', '/compliance-reminders', '/violations', '/claims'].flatMap((path) =>
      PAGING.map(([qs, param]) => [`${path}?${qs}`, param] as const),
    ),
    ...['/work-orders', '/driver-documents', '/violations', '/claims'].flatMap((path) => STATUS.map(([qs, param]) => [`${path}?${qs}`, param] as const)),
  ];

  it.each(MATRIX)('%s → 400 naming %s', async (path, param) => {
    const res = await admin.get(`/api/v1${path}`).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.requestId).toBeTruthy();
    expect(res.body.error.issues.map((i: { path: string }) => i.path)).toContain(param);
  });

  it.each([
    ['/work-orders?status=done&status=due', 'status'],
    ['/claims?status=open&status=denied', 'status'],
  ])('%s (two valid values) → 400 naming %s', async (path, param) => {
    const res = await admin.get(`/api/v1${path}`).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.issues.map((i: { path: string }) => i.path)).toContain(param);
  });
});

describe('Safety access control', () => {
  const PATHS = ['/work-orders', '/driver-documents', '/compliance-reminders', '/violations', '/claims'];

  it('requires a session', async () => {
    for (const path of PATHS) {
      const res = await request(t.server).get(`/api/v1${path}`).expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('lets the Dispatcher read maintenance and compliance but not claims (safety.md §9)', async () => {
    const dispatcher = await t.as('dispatcher');
    for (const path of ['/work-orders', '/driver-documents', '/compliance-reminders', '/violations']) await dispatcher.get(`/api/v1${path}`).expect(200);
    const res = await dispatcher.get('/api/v1/claims').expect(403);
    expect(res.body.error).toMatchObject({ code: 'FORBIDDEN' });
    expect(JSON.stringify(res.body)).not.toContain('Delgado');
  });

  it('follows the role matrix of 07 §2: the Manager reads all five, the Maintenance member only work orders (decision S6)', async () => {
    const manager = await memberWithRole('manager', '100482792');
    const maintenance = await memberWithRole('maintenance', '100482793');
    for (const path of PATHS) {
      expect((await manager.get(`/api/v1${path}?limit=500`).expect(200)).body.meta.total, path).toBeGreaterThan(0);
    }
    expect((await maintenance.get('/api/v1/work-orders?limit=500').expect(200)).body.meta.total).toBe(8);
    for (const path of ['/driver-documents', '/compliance-reminders', '/violations', '/claims']) {
      const res = await maintenance.get(`/api/v1${path}`).expect(403);
      expect(res.body.error.code, path).toBe('FORBIDDEN');
    }
  });

  it('refuses the Accounting and Driver members on all five', async () => {
    for (const user of ['accounting', 'driver'] as const) {
      const agent = await t.as(user);
      for (const path of PATHS) {
        const res = await agent.get(`/api/v1${path}`).expect(403);
        expect(res.body.error.code, `${user} ${path}`).toBe('FORBIDDEN');
      }
    }
  });

  it('shows another organization only its own rows and summaries, never Sunridge’s', async () => {
    const other = await t.as('otherAdmin');
    const wo = await workOrders('/work-orders?limit=500', other);
    expect(wo.data.map((w) => [w.unit.unitNumber, w.item, w.shop.name])).toEqual([['TC-01', 'PM service A', 'Test Carrier shop']]);
    expect(wo.meta.summary).toMatchObject({ workOrderCount: 1, openCount: 1, inShopCount: 0, inShopShops: [], overdue: [], openEstimateCents: 30000 });

    const docs = await documents('/driver-documents?limit=500', other);
    expect(docs.data.map((d) => [d.driver.fullName, d.documentType])).toEqual([['Terry Wheeler', 'cdl']]);
    expect(docs.meta.summary).toMatchObject({ documentCount: 1, driverCount: 1, expiringCount: 0, expired: [], missing: [] });

    const rem = await reminders('/compliance-reminders?limit=500', other);
    expect(rem.data.map((r) => [r.driver.fullName, r.itemLabel])).toEqual([['Terry Wheeler', 'Medical card']]);
    expect(rem.meta.summary.reminderCount).toBe(1);

    const vio = await violations('/violations?limit=500', other);
    expect(vio.data.map((v) => [v.driver.fullName, v.truck.unitNumber, v.location])).toEqual([['Terry Wheeler', 'TC-01', 'I-35 scale · Waco, TX']]);
    expect(vio.meta.summary).toMatchObject({ violationCount: 1, openCount: 1, pointsInWindow: 2, violationsInWindowCount: 1 });

    const cl = await claims('/claims?limit=500', other);
    expect(cl.data.map((c) => [c.claimNumber, c.claimant.name, c.trailer?.unitNumber])).toEqual([[2001, 'Prairie Goods Co', 'TC-T1']]);
    expect(cl.meta.summary).toMatchObject({ claimCount: 1, openCount: 1, openReservedCents: 100000, paidYtdCents: 0, paidYtdCount: 0 });

    const leaked = JSON.stringify([wo, docs, rem, vio, cl]);
    expect(leaked).not.toMatch(/Sunridge|Marcus Hale|Priya Raman|T-118|CLM|Northgate|Delgado/);
    // Sunridge's lists never contain the other tenant's rows either.
    const own = JSON.stringify([
      await workOrders('/work-orders?limit=500'),
      await documents('/driver-documents?limit=500'),
      await reminders('/compliance-reminders?limit=500'),
      await violations('/violations?limit=500'),
      await claims('/claims?limit=500'),
    ]);
    expect(own).not.toMatch(/Terry Wheeler|TC-01|Prairie Goods|Waco/);
  });

  it('writes no audit rows or events for reads (safety.md §1.6)', async () => {
    const count = async () => {
      const r = await t.db.db.execute<{ audits: number; events: number }>(
        sql`SELECT (SELECT count(*) FROM audit_logs)::int AS audits, (SELECT count(*) FROM events)::int AS events`,
      );
      return r.rows[0];
    };
    const before = await count();
    for (const path of PATHS) await admin.get(`/api/v1${path}`).expect(200);
    expect(await count()).toEqual(before);
  });
});
