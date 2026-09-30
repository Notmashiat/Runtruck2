import type { ClaimsMeta, ClaimRow, ViolationRow, ViolationsMeta, WorkOrderRow, WorkOrdersMeta } from '@runtruck/types';
import { workOrderKpis } from '@runtruck/calculations';
import { schema } from '@runtruck/database';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './helpers.js';

// The clock windows and note rules of the safety summaries at their boundaries
// (docs/api/safety.md §1.1, §2.4, §5.4, §6.4, §9 "Unit" list), proven against SQL: rows
// are added to the demo organization of this file's own freshly seeded database.
// today = 2026-09-03: done window ≥ 2026-08-04, points window ≥ 2025-09-04, YTD 2026-01-01 … 2026-09-03.

let t: TestContext;
let admin: Awaited<ReturnType<TestContext['as']>>;
let org: string;

async function id(table: 'trucks' | 'trailers', unitNumber: string): Promise<string> {
  const tbl = table === 'trucks' ? schema.trucks : schema.trailers;
  const [row] = await t.db.db.select({ id: tbl.id }).from(tbl).where(and(eq(tbl.organizationId, org), eq(tbl.unitNumber, unitNumber)));
  if (!row) throw new Error(`${unitNumber} missing`);
  return row.id;
}

async function facility(name: string): Promise<string> {
  const [row] = await t.db.db
    .select({ id: schema.facilities.id })
    .from(schema.facilities)
    .where(and(eq(schema.facilities.organizationId, org), eq(schema.facilities.name, name)));
  if (!row) throw new Error(`${name} missing`);
  return row.id;
}

async function driver(lastName: string): Promise<string> {
  const [row] = await t.db.db
    .select({ id: schema.drivers.id })
    .from(schema.drivers)
    .innerJoin(schema.employees, and(eq(schema.employees.organizationId, schema.drivers.organizationId), eq(schema.employees.id, schema.drivers.employeeId)))
    .where(and(eq(schema.drivers.organizationId, org), eq(schema.employees.lastName, lastName)));
  if (!row) throw new Error(`${lastName} missing`);
  return row.id;
}

beforeAll(async () => {
  t = await createTestContext();
  admin = await t.as('admin');
  org = t.orgs.demoOrganizationId;
});
afterAll(async () => {
  await t.close();
});

interface Envelope<T, M> {
  data: T;
  meta: M;
}

async function get<T, M>(path: string): Promise<Envelope<T, M>> {
  const res = await admin.get(`/api/v1${path}`).expect(200);
  return res.body as Envelope<T, M>;
}

describe('work-order summary rules', () => {
  it('counts a done order completed exactly today − 30, not the day before; lists each in-shop facility once in row order, and overdue trailers', async () => {
    const sunridge = await facility('Sunridge shop');
    const thermo = await facility('Thermo King');
    // A third shop; facility names are unique per organization (facilities_org_name_uq).
    const [diesel] = await t.db.db
      .insert(schema.facilities)
      .values({ organizationId: org, name: 'Modesto Diesel', kind: 'shop', city: 'Modesto', state: 'CA', timezone: 'America/Los_Angeles' })
      .returning({ id: schema.facilities.id });
    const base = { organizationId: org, item: 'Rule check', estimateCents: 1000 };
    await t.db.db.insert(schema.workOrders).values([
      { ...base, truckId: await id('trucks', 'T-103'), dueOn: '2026-08-04', shopFacilityId: sunridge, status: 'done', completedOn: '2026-08-04', position: 20 },
      { ...base, truckId: await id('trucks', 'T-107'), dueOn: '2026-08-03', shopFacilityId: sunridge, status: 'done', completedOn: '2026-08-03', position: 21 },
      { ...base, truckId: await id('trucks', 'T-109'), dueOdometer: 1000, shopFacilityId: thermo, status: 'in_shop', position: 22 },
      { ...base, trailerId: await id('trailers', 'DV-88'), dueOn: '2026-09-01', shopFacilityId: sunridge, status: 'in_shop', position: 23 },
      { ...base, trailerId: await id('trailers', 'FB-04'), dueOn: '2026-09-01', shopFacilityId: diesel?.id ?? '', status: 'in_shop', position: 24 },
      { ...base, trailerId: await id('trailers', 'RF-09'), dueOn: '2026-08-30', shopFacilityId: thermo, status: 'overdue', position: 25 },
    ]);

    const { data, meta } = await get<WorkOrderRow[], WorkOrdersMeta>('/work-orders?limit=500');
    expect(data).toHaveLength(14);
    expect(meta.summary).toMatchObject({
      workOrderCount: 14,
      openCount: 11,
      doneLast30dCount: 2,
      inShopCount: 5,
      openEstimateCents: 711500 + 4 * 1000,
    });
    expect(meta.summary.inShopShops.map((s) => [s.facilityId, s.name, s.city])).toEqual([
      [sunridge, 'Sunridge shop', 'Modesto'],
      [thermo, 'Thermo King', 'Fresno'],
      [diesel?.id, 'Modesto Diesel', 'Modesto'],
    ]);
    expect(meta.summary.overdue.map((o) => `${o.unitNumber} · ${o.item}`)).toEqual(['T-121 · Brake adjustment', 'RF-09 · Rule check']);
    expect(workOrderKpis(meta.summary).slice(0, 3)).toEqual([
      { label: 'Open work orders', value: '11', note: '2 done · last 30 d' },
      { label: 'In shop', value: '5', note: 'Sunridge shop · Modesto, Thermo King · Fresno, Modesto Diesel · Modesto' },
      { label: 'Overdue', value: '2', note: 'T-121 · Brake adjustment, RF-09 · Rule check' },
    ]);
  });
});

describe('violation summary rules', () => {
  it('counts a violation the day after today − 1 year, not on it, whatever its status', async () => {
    const base = { organizationId: org, driverId: await driver('Hale'), truckId: await id('trucks', 'T-114'), violationType: 'Rule check', location: 'Test' };
    await t.db.db.insert(schema.violations).values([
      { ...base, occurredOn: '2025-09-03', severityPoints: 10, status: 'closed' },
      { ...base, occurredOn: '2025-09-04', severityPoints: 3, status: 'closed' },
      { ...base, occurredOn: '2026-09-03', severityPoints: 2, status: 'contested' },
    ]);
    const { data, meta } = await get<ViolationRow[], ViolationsMeta>('/violations?limit=500');
    expect(data.map((v) => v.occurredOn).slice(0, 2)).toEqual(['2026-09-03', '2026-08-31']);
    expect(data.at(-1)?.occurredOn).toBe('2025-09-03');
    expect(meta.summary).toEqual({
      asOf: '2026-09-03',
      pointsWindowStart: '2025-09-04',
      violationCount: 10,
      openCount: 2,
      contestedCount: 2,
      closedCount: 6,
      pointsInWindow: 29 + 3 + 2,
      violationsInWindowCount: 9,
    });
  });
});

describe('claim summary rules', () => {
  it('counts a paid claim dated Jan 1 of this year in Paid YTD, not one dated Dec 31 of last year (decision S5)', async () => {
    const base = {
      organizationId: org,
      driverId: await driver('Cortez'),
      truckId: await id('trucks', 'T-109'),
      claimType: 'cargo_damage' as const,
      claimantKind: 'third_party' as const,
      claimantName: 'Rule Check',
      reservedCents: 10000,
    };
    await t.db.db.insert(schema.claims).values([
      { ...base, claimNumber: 901, occurredOn: '2025-12-31', paidCents: 5000, status: 'settled' },
      { ...base, claimNumber: 902, occurredOn: '2026-01-01', paidCents: 7000, status: 'settled' },
      { ...base, claimNumber: 903, occurredOn: '2026-02-01', paidCents: 0, status: 'under_review' },
    ]);
    const { data, meta } = await get<ClaimRow[], ClaimsMeta>('/claims?limit=500');
    expect(data.map((c) => c.claimNumber)).toEqual([1112, 1111, 1110, 1109, 1108, 1107, 903, 902, 901]);
    expect(data.find((c) => c.claimNumber === 903)).toMatchObject({ trailer: null, load: null, claimant: { kind: 'third_party', name: 'Rule Check' } });
    expect(meta.summary).toMatchObject({
      claimCount: 9,
      openCount: 3,
      underReviewCount: 2,
      openReservedCents: 1100000 + 10000,
      paidYtdCents: 2402500 + 7000,
      paidYtdCount: 4,
      settledCount: 5,
      deniedCount: 1,
    });
  });
});
