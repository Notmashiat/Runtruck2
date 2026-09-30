import {
  dashboardKpis,
  dashboardRevenueChart,
  loadRowMatches,
  toDashboardDriverRow,
  toDashboardRow,
  toLoadSearchRow,
} from '@runtruck/calculations';
import { hashPassword, schema } from '@runtruck/database';
import { OTHER_ORG_FIXTURE } from '@runtruck/database/testing';
import type { RoleKey } from '@runtruck/permissions';
import type { DashboardData, DashboardMeta, LoadListItem, UninvoicedLoadsMeta } from '@runtruck/types';
import { and, asc, count, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, TEST_PASSWORD, type TestContext } from './helpers.js';

// docs/api/dashboard.md §2.11: GET /dashboard against the demo seed — exact seeded figures,
// a created load, tenant isolation, permissions, validation, and no audit/event writes.

type Agent = ReturnType<typeof request.agent>;

interface DashboardBody {
  data: DashboardData;
  meta: DashboardMeta;
}

let t: TestContext;
let rosa: Agent;
let dispatcher: Agent;
let accounting: Agent;
let driver: Agent;
let maintenance: Agent;
let manager: Agent;
let other: Agent;
let demo: string;

const db = () => t.db.db;

// A demo-organization member holding one of the organization's default roles.
async function memberWithRole(role: RoleKey, memberNumber: string): Promise<Agent> {
  const email = `${role}.dashboard@sunridgefreight.test`;
  const [roleRow] = await db()
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(and(eq(schema.roles.organizationId, demo), eq(schema.roles.key, role)));
  const [user] = await db()
    .insert(schema.users)
    .values({ email, fullName: `Fixture ${role}`, passwordHash: await hashPassword(TEST_PASSWORD) })
    .returning({ id: schema.users.id });
  await db().insert(schema.organizationMembers).values({ organizationId: demo, userId: user!.id, memberNumber, title: role });
  await db().insert(schema.userRoles).values({ organizationId: demo, userId: user!.id, roleId: roleRow!.id });
  const agent = request.agent(t.server);
  await agent.post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD }).expect(200);
  return agent;
}

async function customerId(name: string): Promise<string> {
  const [row] = await db()
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(and(eq(schema.customers.organizationId, demo), eq(schema.customers.name, name)));
  return row!.id;
}

async function tableCount(table: typeof schema.auditLogs | typeof schema.events): Promise<number> {
  const [row] = await db().select({ n: count() }).from(table);
  return row!.n;
}

async function dashboard(agent: Agent): Promise<DashboardBody> {
  return (await agent.get('/api/v1/dashboard').expect(200)).body as DashboardBody;
}

beforeAll(async () => {
  t = await createTestContext();
  demo = t.orgs.demoOrganizationId;
  rosa = await t.as('admin');
  dispatcher = await t.as('dispatcher');
  accounting = await t.as('accounting');
  driver = await t.as('driver');
  other = await t.as('otherAdmin');
  maintenance = await memberWithRole('maintenance', '900000101');
  manager = await memberWithRole('manager', '900000102');
});
afterAll(async () => {
  await t.close();
});

// The seed figures of dashboard.md §2.4–§2.5 (today = 2026-09-03).
const SEED_ACTIVE_LOADS = [
  [40218, 'Northgate Foods', 'Fresno, CA → Reno, NV', 245_000, 'in_transit'],
  [40219, 'Bayline Distribution', 'Stockton, CA → Salt Lake City, UT', 318_000, 'at_pickup'],
  [40220, 'Cascade Building Supply', 'Sacramento, CA → Boise, ID', 291_000, 'delayed'],
  [40221, 'Harbor Point Retail', 'Oakland, CA → Portland, OR', 354_000, 'needs_driver'],
  [40222, 'Cascade Building Supply', 'Redding, CA → Seattle, WA', 276_000, 'dispatched'],
];

const SEED_REVENUE = [
  { date: '2026-08-27', revenueCents: 441_000 },
  { date: '2026-08-28', revenueCents: 305_000 },
  { date: '2026-08-29', revenueCents: 276_000 },
  { date: '2026-08-30', revenueCents: 774_000 },
  { date: '2026-08-31', revenueCents: 486_000 },
  { date: '2026-09-01', revenueCents: 930_000 },
  { date: '2026-09-02', revenueCents: 1_052_000 },
];

const SEED_DRIVERS = [
  ['Marcus Hale', 'on_duty', 380],
  ['Dara Whitfield', 'on_duty', 545],
  ['Ellis Nakamura', 'on_duty', 105],
  ['Priya Raman', 'available', 660],
  ['Ana Cortez', 'available', 660],
  ['Tobias Frey', 'home_time', null],
];

const SEED_SUMMARY = {
  activeLoads: { count: 5, lastWeekCount: 3, deltaVsLastWeek: 2 },
  revenueThisWeek: { thisWeekCents: 2_468_000, previousWeekCents: 1_796_000, changeTenthsOfPercent: 374 },
  deadheadMiles: { percentTenths: 78, previousWeekPercentTenths: 92, pointsBetterTenths: 14 },
  unbilledLoads: { count: 11, amountCents: 3_490_000 },
};

describe('GET /dashboard — seed values (§2.11 item 1)', () => {
  it('returns exactly the seeded table, chart, drivers and summary for Rosa', async () => {
    const { data, meta } = await dashboard(rosa);

    expect(data.activeLoads.map((l) => [l.loadNumber, l.customerName, l.route, l.lineHaulCents, l.status])).toEqual(SEED_ACTIVE_LOADS);
    for (const l of data.activeLoads) expect(l.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(data.revenueLastSevenDays).toEqual(SEED_REVENUE);
    expect(data.drivers.map((d) => [d.name, d.dutyStatus, d.hosRemainingMinutes])).toEqual(SEED_DRIVERS);
    for (const d of data.drivers) expect(d.id).toMatch(/^[0-9a-f-]{36}$/);

    expect(meta).toEqual({ today: '2026-09-03', weekStart: '2026-08-31', weekEnd: '2026-09-06', summary: SEED_SUMMARY });
  });

  it('exposes exactly the documented fields and nothing else', async () => {
    const { data } = await dashboard(rosa);
    expect(Object.keys(data).sort()).toEqual(['activeLoads', 'drivers', 'revenueLastSevenDays']);
    expect(Object.keys(data.activeLoads[0]!).sort()).toEqual(['customerName', 'id', 'lineHaulCents', 'loadNumber', 'route', 'status']);
    expect(Object.keys(data.drivers[0]!).sort()).toEqual(['dutyStatus', 'hosRemainingMinutes', 'id', 'name']);
  });

  it('computes routes byte-identical to GET /loads and the unbilled figure of GET /billing/uninvoiced-loads (§3)', async () => {
    const { data, meta } = await dashboard(rosa);
    const board = (await rosa.get('/api/v1/loads?view=active&limit=500').expect(200)).body.data as LoadListItem[];
    expect(data.activeLoads.map((l) => [l.id, l.route])).toEqual(board.slice(0, 6).map((l) => [l.id, l.route]));

    const uninvoiced = (await rosa.get('/api/v1/billing/uninvoiced-loads?limit=500').expect(200)).body.meta as UninvoicedLoadsMeta;
    expect(meta.summary.unbilledLoads).toEqual({ count: uninvoiced.summary.loadCount, amountCents: uninvoiced.summary.amountCents });
  });

  it('renders the documented Runtruck1 strings through the shared view-model builders (§4, §5.2–§5.5)', async () => {
    const { data, meta } = await dashboard(rosa);

    expect(dashboardKpis(meta.summary)).toEqual([
      { label: 'Active loads', value: '5', note: '+2 vs. last week' },
      { label: 'Revenue this week', value: '$25K', note: '+37.4%' },
      { label: 'Deadhead miles', value: '7.8%', note: '1.4 pts better' },
      { label: 'Unbilled loads', value: '11', note: '$34,900 waiting' },
    ]);
    expect(data.activeLoads.map(toDashboardRow).map((r) => [r.id, r.customer, r.route, r.rate, r.status, r.tone])).toEqual([
      ['L-40218', 'Northgate Foods', 'Fresno, CA → Reno, NV', '$2,450', 'In transit', 'blue'],
      ['L-40219', 'Bayline Distribution', 'Stockton, CA → Salt Lake City, UT', '$3,180', 'At pickup', 'gray'],
      ['L-40220', 'Cascade Building Supply', 'Sacramento, CA → Boise, ID', '$2,910', 'Delayed', 'amber'],
      ['L-40221', 'Harbor Point Retail', 'Oakland, CA → Portland, OR', '$3,540', 'Needs driver', 'amber'],
      ['L-40222', 'Cascade Building Supply', 'Redding, CA → Seattle, WA', '$2,760', 'Dispatched', 'gray'],
    ]);
    const primary = 'var(--ui-primary)';
    const soft = 'var(--ui-primary-soft)';
    expect(dashboardRevenueChart(data.revenueLastSevenDays).map((c) => [c.day, c.h, c.fill])).toEqual([
      ['Thu', '42%', soft],
      ['Fri', '29%', soft],
      ['Sat', '26%', soft],
      ['Sun', '74%', soft],
      ['Mon', '46%', soft],
      ['Tue', '88%', soft],
      ['Wed', '100%', primary],
    ]);
    expect(data.drivers.map(toDashboardDriverRow).map((d) => [d.name, d.note, d.dot])).toEqual([
      ['Marcus Hale', 'On duty · 6h 20m left', primary],
      ['Dara Whitfield', 'On duty · 9h 05m left', primary],
      ['Ellis Nakamura', 'On duty · 1h 45m left', primary],
      ['Priya Raman', 'Available', 'var(--ui-green)'],
      ['Ana Cortez', 'Available', 'var(--ui-green)'],
      ['Tobias Frey', 'Home time', 'var(--ui-muted)'],
    ]);
  });

  it('searches the Loads board rows exactly like Runtruck1 (§5.3, §5.6)', async () => {
    const board = (await rosa.get('/api/v1/loads?view=all&limit=500').expect(200)).body.data as LoadListItem[];
    const rows = board.map((l) => toLoadSearchRow(l, { timeZone: 'America/Los_Angeles', today: '2026-09-03' }));
    // Runtruck1: (searching ? loads.filter(l => matchesQuery(l, query)) : active).slice(0, 6)
    const search = (q: string) =>
      rows
        .filter((r) => loadRowMatches(r, q))
        .slice(0, 6)
        .map((r) => r.id);

    // Runtruck1's LOADS order.
    expect(rows.map((r) => r.id)).toEqual(['L-40218', 'L-40219', 'L-40220', 'L-40221', 'L-40214', 'L-40212', 'L-40210', 'L-40222']);
    // Non-active loads are listed while searching (B3), hidden fields match, and 6 is the cap.
    expect(search('delivered')).toEqual(['L-40212', 'L-40210']);
    expect(search(' 812044 ')).toEqual(['L-40218', 'L-40219', 'L-40220', 'L-40214', 'L-40212', 'L-40210']);
    expect(search('Frozen produce')).toEqual(['L-40218']);
    // No uuid, cents, enum value or tone can match.
    for (const q of [board[0]!.id, '245000', 'in_transit', 'needs_driver', 'blue']) expect(search(q)).toEqual([]);
  });

  it('is read-only: no audit row and no domain event', async () => {
    const [audit, events] = [await tableCount(schema.auditLogs), await tableCount(schema.events)];
    await dashboard(rosa);
    await dashboard(dispatcher);
    expect([await tableCount(schema.auditLogs), await tableCount(schema.events)]).toEqual([audit, events]);
  });
});

describe('GET /dashboard — permissions (§2.11 item 4)', () => {
  it('requires a session', async () => {
    const res = await request(t.server).get('/api/v1/dashboard').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('refuses the Driver and Maintenance roles (no dashboard.view)', async () => {
    for (const agent of [driver, maintenance]) {
      const res = await agent.get('/api/v1/dashboard').expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body).not.toHaveProperty('data');
    }
  });

  it('serves Dispatcher, Accounting and Manager the same figures, billing totals included', async () => {
    const admin = await dashboard(rosa);
    for (const agent of [dispatcher, accounting, manager]) {
      const body = await dashboard(agent);
      expect(body.meta.summary).toEqual(admin.meta.summary);
      expect(body.data).toEqual(admin.data);
    }
  });
});

describe('GET /dashboard — validation (§2.11 item 5)', () => {
  it('rejects any query parameter with VALIDATION_ERROR', async () => {
    const res = await rosa.get('/api/v1/dashboard?q=x').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.issues).toEqual([{ path: '', message: 'Unrecognized key: "q"' }]);
    expect(res.body.error.requestId).toBeTruthy();
    for (const qs of ['limit=6', 'offset=0', 'organizationId=00000000-0000-4000-8000-000000000000']) {
      expect((await rosa.get(`/api/v1/dashboard?${qs}`).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('GET /dashboard — tenant isolation (§2.11 item 3)', () => {
  it('shows the other organization only its own rows and figures', async () => {
    const { data, meta } = await dashboard(other);
    // Test Carrier Co (fixture C10): one in-transit board load, one archived invoiced load
    // without stops, one driver; DEMO_TODAY pins its business date as well.
    expect(data.activeLoads.map((l) => [l.loadNumber, l.customerName, l.route, l.lineHaulCents, l.status])).toEqual([
      [OTHER_ORG_FIXTURE.loadNumber, OTHER_ORG_FIXTURE.customerName, 'Dallas, TX → Houston, TX', 150_000, 'in_transit'],
    ]);
    expect(data.revenueLastSevenDays).toEqual(SEED_REVENUE.map((d) => ({ ...d, revenueCents: 0 })));
    expect(data.drivers.map((d) => [d.name, d.dutyStatus, d.hosRemainingMinutes])).toEqual([
      [OTHER_ORG_FIXTURE.driverName, 'on_duty', 300],
    ]);
    expect(meta).toEqual({
      today: '2026-09-03',
      weekStart: '2026-08-31',
      weekEnd: '2026-09-06',
      summary: {
        activeLoads: { count: 1, lastWeekCount: 0, deltaVsLastWeek: 1 },
        revenueThisWeek: { thisWeekCents: 0, previousWeekCents: 0, changeTenthsOfPercent: null },
        // 20 empty of 260 total miles → 7.69 % → 77 tenths; no load last week.
        deadheadMiles: { percentTenths: 77, previousWeekPercentTenths: null, pointsBetterTenths: null },
        unbilledLoads: { count: 0, amountCents: 0 },
      },
    });

    const text = JSON.stringify(data);
    for (const leak of ['Northgate', 'Sunridge', 'Marcus Hale', '40218']) expect(text).not.toContain(leak);
  });

  it('never lets the demo organization see the other tenant', async () => {
    const text = JSON.stringify(await dashboard(rosa));
    for (const leak of [OTHER_ORG_FIXTURE.customerName, OTHER_ORG_FIXTURE.driverName, String(OTHER_ORG_FIXTURE.loadNumber)])
      expect(text).not.toContain(leak);
  });
});

describe('GET /dashboard — created loads (§2.11 item 2)', () => {
  const newLoad = async (pickupDate: string) => ({
    customerId: await customerId('Harbor Point Retail'),
    mode: 'ftl',
    equipmentType: 'dry_van_53',
    stops: [
      {
        kind: 'pickup',
        facilityName: 'Port of Oakland',
        addressLine1: '1599 Maritime St',
        city: 'Oakland',
        state: 'CA',
        appointmentDate: pickupDate,
      },
      {
        kind: 'delivery',
        facilityName: 'Harbor Point DC',
        addressLine1: '6200 N Basin Ave',
        city: 'Portland',
        state: 'OR',
        appointmentDate: '2026-09-08',
      },
    ],
    commodity: 'Consumer goods',
    weightLb: 30_100,
    haul: { hauledBy: 'own_fleet', driverId: null, truckId: null, trailerId: null, driverPayCents: null },
    lineHaulCents: 300_000,
    paymentTerms: 'net_30',
  });

  it('puts a load created by the Dispatcher first and counts it (+3 vs. last week)', async () => {
    const created = (
      await dispatcher
        .post('/api/v1/loads')
        .send(await newLoad('2026-09-05'))
        .expect(201)
    ).body.data as { loadNumber: number };
    expect(created.loadNumber).toBe(40223);

    const { data, meta } = await dashboard(rosa);
    expect(meta.summary.activeLoads).toEqual({ count: 6, lastWeekCount: 3, deltaVsLastWeek: 3 });
    expect(data.activeLoads.map((l) => l.loadNumber)).toEqual([40223, 40218, 40219, 40220, 40221, 40222]);
    expect(data.activeLoads[0]).toMatchObject({
      customerName: 'Harbor Point Retail',
      route: 'Oakland, CA → Portland, OR',
      lineHaulCents: 300_000,
      status: 'needs_driver',
    });
    // Nothing else moves: the load is neither delivered nor billed.
    expect(meta.summary.revenueThisWeek).toEqual(SEED_SUMMARY.revenueThisWeek);
    expect(meta.summary.unbilledLoads).toEqual(SEED_SUMMARY.unbilledLoads);
    expect(data.revenueLastSevenDays).toEqual(SEED_REVENUE);
  });

  it('keeps the table at 6 rows while the KPI keeps counting (L-40222 drops out)', async () => {
    await dispatcher
      .post('/api/v1/loads')
      .send(await newLoad('2026-09-06'))
      .expect(201);
    const { data, meta } = await dashboard(rosa);
    expect(meta.summary.activeLoads).toEqual({ count: 7, lastWeekCount: 3, deltaVsLastWeek: 4 });
    expect(data.activeLoads.map((l) => l.loadNumber)).toEqual([40224, 40223, 40218, 40219, 40220, 40221]);
  });

  it('does not change the other organization', async () => {
    const { meta } = await dashboard(other);
    expect(meta.summary.activeLoads).toEqual({ count: 1, lastWeekCount: 0, deltaVsLastWeek: 1 });
  });
});

describe('GET /dashboard — delivered_on from the stop completion (§2.3, §2.7 query 3)', () => {
  // L-40212 (delivered, Sunset Beverage DC, America/Los_Angeles): its seeded last delivery
  // has no completed_at, so it is charted on its appointment date 2026-09-01.
  async function stopsOf(loadNumber: number) {
    const [load] = await db()
      .select({ id: schema.loads.id, revenue: schema.loads.lineHaulCents, fuel: schema.loads.fuelSurchargeCents, acc: schema.loads.accessorialCents })
      .from(schema.loads)
      .where(and(eq(schema.loads.organizationId, demo), eq(schema.loads.loadNumber, loadNumber)));
    const stops = await db()
      .select({ id: schema.loadStops.id, kind: schema.loadStops.kind, timezone: schema.loadStops.timezone, date: schema.loadStops.appointmentDate })
      .from(schema.loadStops)
      .where(and(eq(schema.loadStops.organizationId, demo), eq(schema.loadStops.loadId, load!.id)))
      .orderBy(asc(schema.loadStops.sequence));
    return { revenueCents: load!.revenue + load!.fuel + load!.acc, stops };
  }

  const chartOf = async () => (await dashboard(rosa)).data.revenueLastSevenDays.map((d) => d.revenueCents);

  it('dates a completed delivery in the stop timezone and finds it even when every stop is dated elsewhere', async () => {
    const { revenueCents, stops } = await stopsOf(40212);
    const delivery = stops[stops.length - 1]!;
    expect([delivery.kind, delivery.timezone, delivery.date]).toEqual(['delivery', 'America/Los_Angeles', '2026-09-01']);
    const before = await dashboard(rosa);
    const seedChart = before.data.revenueLastSevenDays.map((d) => d.revenueCents);
    const moved = (from: number, to: number | null) =>
      seedChart.map((v, i) => v - (i === from ? revenueCents : 0) + (i === to ? revenueCents : 0));
    const setCompleted = (at: Date) =>
      db().update(schema.loadStops).set({ completedAt: at }).where(eq(schema.loadStops.id, delivery.id));

    try {
      // 06:30Z on Sep 3 is 23:30 on Sep 2 in Los Angeles: charted on Wed (index 6), not today.
      await setCompleted(new Date('2026-09-03T06:30:00Z'));
      expect(await chartOf()).toEqual(moved(5, 6));

      // Every stop dated 2026-08-10 (outside the candidate date range): the completion still counts.
      for (const s of stops) await db().update(schema.loadStops).set({ appointmentDate: '2026-08-10' }).where(eq(schema.loadStops.id, s.id));
      expect(await chartOf()).toEqual(moved(5, 6));

      // 07:30Z on Sep 3 is 00:30 today in Los Angeles: off the chart, still in this week's revenue.
      await setCompleted(new Date('2026-09-03T07:30:00Z'));
      const { data, meta } = await dashboard(rosa);
      expect(data.revenueLastSevenDays.map((d) => d.revenueCents)).toEqual(moved(5, null));
      expect(meta.summary.revenueThisWeek).toEqual(before.meta.summary.revenueThisWeek);
    } finally {
      await db().update(schema.loadStops).set({ completedAt: null }).where(eq(schema.loadStops.id, delivery.id));
      for (const s of stops) await db().update(schema.loadStops).set({ appointmentDate: s.date }).where(eq(schema.loadStops.id, s.id));
    }
    expect(await chartOf()).toEqual(seedChart);
  });
});
