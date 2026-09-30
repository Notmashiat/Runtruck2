import {
  boardStops,
  formatActivityTime,
  LOAD_DOCUMENT_STATUS_LABEL,
  LOAD_DOCUMENT_TYPE_LABEL,
  stopKindClass,
  stopKindLabel,
  stopTimeLine,
  toLoadSearchRow,
} from '@runtruck/calculations';
import { hashPassword, schema } from '@runtruck/database';
import { OTHER_ORG_FIXTURE } from '@runtruck/database/testing';
import type { Permission } from '@runtruck/permissions';
import type { LoadDetail, LoadListItem } from '@runtruck/types';
import { and, asc, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, TEST_PASSWORD, type TestContext, WEB_ORIGIN } from './helpers.js';

// docs/api/loads.md: GET /loads, GET /loads/by-number/:n, GET /loads/:id, POST /loads —
// seeded values, 401/403, tenant isolation, validation, audit rows and outbox events.

type Agent = ReturnType<typeof request.agent>;

let t: TestContext;
let rosa: Agent;
let driver: Agent;
let accounting: Agent;
let other: Agent;
let viewOnly: Agent;
let createOnly: Agent;
let demo: string;

const db = () => t.db.db;
const BOARD_ORDER = [40218, 40219, 40220, 40221, 40214, 40212, 40210, 40222];

// A member of the demo organization holding exactly `permissions` (a custom role).
async function customMember(key: string, memberNumber: string, permissions: Permission[]): Promise<Agent> {
  const email = `${key}@sunridgefreight.test`;
  const [role] = await db().insert(schema.roles).values({ organizationId: demo, key: `custom_${key}`, name: key }).returning({ id: schema.roles.id });
  const perms = await db().select({ id: schema.permissions.id }).from(schema.permissions).where(inArray(schema.permissions.key, permissions));
  await db().insert(schema.rolePermissions).values(perms.map((p) => ({ roleId: role!.id, permissionId: p.id })));
  const [user] = await db()
    .insert(schema.users)
    .values({ email, fullName: `Custom ${key}`, passwordHash: await hashPassword(TEST_PASSWORD) })
    .returning({ id: schema.users.id });
  await db().insert(schema.organizationMembers).values({ organizationId: demo, userId: user!.id, memberNumber, title: 'Custom' });
  await db().insert(schema.userRoles).values({ organizationId: demo, userId: user!.id, roleId: role!.id });
  const agent = request.agent(t.server);
  await agent.post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD }).expect(200);
  return agent;
}

async function customerId(org: string, name: string): Promise<string> {
  const [row] = await db().select({ id: schema.customers.id }).from(schema.customers).where(and(eq(schema.customers.organizationId, org), eq(schema.customers.name, name)));
  return row!.id;
}

async function carrierId(org: string, name: string): Promise<string> {
  const [row] = await db().select({ id: schema.carriers.id }).from(schema.carriers).where(and(eq(schema.carriers.organizationId, org), eq(schema.carriers.name, name)));
  return row!.id;
}

async function driverId(org: string, fullName: string): Promise<string> {
  const [first, last] = fullName.split(' ');
  const [row] = await db()
    .select({ id: schema.drivers.id })
    .from(schema.drivers)
    .innerJoin(schema.employees, eq(schema.employees.id, schema.drivers.employeeId))
    .where(and(eq(schema.drivers.organizationId, org), eq(schema.employees.firstName, first!), eq(schema.employees.lastName, last!)));
  return row!.id;
}

async function truckId(org: string, unit: string): Promise<string> {
  const [row] = await db().select({ id: schema.trucks.id }).from(schema.trucks).where(and(eq(schema.trucks.organizationId, org), eq(schema.trucks.unitNumber, unit)));
  return row!.id;
}

async function trailerId(org: string, unit: string): Promise<string> {
  const [row] = await db().select({ id: schema.trailers.id }).from(schema.trailers).where(and(eq(schema.trailers.organizationId, org), eq(schema.trailers.unitNumber, unit)));
  return row!.id;
}

async function auditRows(entityId: string) {
  return db()
    .select({ action: schema.auditLogs.action, entityType: schema.auditLogs.entityType, entityLabel: schema.auditLogs.entityLabel, next: schema.auditLogs.next, actorUserId: schema.auditLogs.actorUserId })
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.entityId, entityId))
    .orderBy(asc(schema.auditLogs.occurredAt), asc(schema.auditLogs.action));
}

async function eventRows(aggregateId: string) {
  return db()
    .select({ type: schema.events.type, aggregateType: schema.events.aggregateType, payload: schema.events.payload, organizationId: schema.events.organizationId })
    .from(schema.events)
    .where(eq(schema.events.aggregateId, aggregateId));
}

beforeAll(async () => {
  t = await createTestContext();
  demo = t.orgs.demoOrganizationId;
  rosa = await t.as('admin');
  driver = await t.as('driver');
  accounting = await t.as('accounting');
  other = await t.as('otherAdmin');
  viewOnly = await customMember('loadsviewer', '900000001', ['loads.view']);
  createOnly = await customMember('loadscreator', '900000002', ['loads.view', 'loads.create']);
});
afterAll(async () => {
  await t.close();
});

// Runtruck1 mock.ts LOADS, verbatim (tagClass → chip tone): the strings the board, the
// expand row and the detail page print for the eight seeded loads (core-pages §3, §7.1).
const RUNTRUCK1_LOADS = [
  { id: 'L-40218', customer: 'Northgate Foods', route: 'Fresno, CA → Reno, NV', pickup: 'Sep 3', delivery: 'Sep 4', driver: 'Marcus Hale', unit: 'T-114 / RF-88', rate: '$2,450', status: 'In transit', tone: 'blue',
    miles: '478', rpm: '$5.13', pay: '$612', margin: '$1,214', commodity: 'Frozen produce', weight: '41,200 lb', equip: 'Reefer, 53 ft', temp: '-10 °F', ref: 'PO 88-41207',
    from: 'Northgate Cold Storage', fromAddr: '4120 S Golden State Blvd, Fresno, CA', to: 'Reno Grocers DC', toAddr: '1855 E Greg St, Sparks, NV', carrier: 'Sunridge Freight (own fleet)', carrierMc: 'MC 812044', carrierDot: 'DOT 2291176' },
  { id: 'L-40219', customer: 'Bayline Distribution', route: 'Stockton, CA → Salt Lake City, UT', pickup: 'Sep 3', delivery: 'Sep 5', driver: 'Dara Whitfield', unit: 'T-107 / DV-51', rate: '$3,180', status: 'At pickup', tone: 'gray',
    miles: '736', rpm: '$4.32', pay: '$795', margin: '$1,540', commodity: 'Palletized dry goods', weight: '38,500 lb', equip: 'Dry van, 53 ft', temp: 'Ambient', ref: 'PO 55-90114',
    from: 'Bayline DC 4', fromAddr: '2900 Navy Dr, Stockton, CA', to: 'Wasatch Crossdock', toAddr: '1740 S 4130 W, Salt Lake City, UT', carrier: 'Sunridge Freight (own fleet)', carrierMc: 'MC 812044', carrierDot: 'DOT 2291176' },
  { id: 'L-40220', customer: 'Cascade Building Supply', route: 'Sacramento, CA → Boise, ID', pickup: 'Sep 2', delivery: 'Sep 4', driver: 'Ellis Nakamura', unit: 'T-121 / FB-12', rate: '$2,910', status: 'Delayed', tone: 'amber',
    miles: '602', rpm: '$4.83', pay: '$728', margin: '$1,388', commodity: 'Lumber', weight: '44,000 lb', equip: 'Flatbed, tarped', temp: 'Ambient', ref: 'SO 7741',
    from: 'Cascade Yard 2', fromAddr: '8300 Elder Creek Rd, Sacramento, CA', to: 'Boise Builders Depot', toAddr: '440 E Corporate Dr, Meridian, ID', carrier: 'Sunridge Freight (own fleet)', carrierMc: 'MC 812044', carrierDot: 'DOT 2291176' },
  { id: 'L-40221', customer: 'Harbor Point Retail', route: 'Oakland, CA → Portland, OR', pickup: 'Sep 4', delivery: 'Sep 6', driver: 'Unassigned', unit: '—', rate: '$3,540', status: 'Needs driver', tone: 'amber',
    miles: '632', rpm: '$5.60', pay: '—', margin: '—', commodity: 'Consumer goods', weight: '30,100 lb', equip: 'Dry van, 53 ft', temp: 'Ambient', ref: 'PO 31-2280',
    from: 'Port of Oakland, Berth 22', fromAddr: '1599 Maritime St, Oakland, CA', to: 'Harbor Point DC', toAddr: '6200 N Basin Ave, Portland, OR', carrier: 'Not yet covered', carrierMc: '—', carrierDot: '—' },
  { id: 'L-40214', customer: 'Northgate Foods', route: 'Bakersfield, CA → Phoenix, AZ', pickup: 'Sep 1', delivery: 'Sep 2', driver: 'Priya Raman', unit: 'T-103 / RF-27', rate: '$1,980', status: 'Needs POD', tone: 'amber',
    miles: '389', rpm: '$5.09', pay: '$495', margin: '$986', commodity: 'Dairy', weight: '36,800 lb', equip: 'Reefer, 53 ft', temp: '34 °F', ref: 'PO 88-41190',
    from: 'Northgate Creamery', fromAddr: '3011 Buck Owens Blvd, Bakersfield, CA', to: 'Valley Foods DC', toAddr: '2240 W Buckeye Rd, Phoenix, AZ', carrier: 'Sunridge Freight (own fleet)', carrierMc: 'MC 812044', carrierDot: 'DOT 2291176' },
  { id: 'L-40212', customer: 'Bayline Distribution', route: 'Los Angeles, CA → Las Vegas, NV', pickup: 'Aug 31', delivery: 'Sep 1', driver: 'Marcus Hale', unit: 'T-114 / DV-88', rate: '$1,640', status: 'Delivered', tone: 'gray',
    miles: '271', rpm: '$6.05', pay: '$410', margin: '$842', commodity: 'Beverages', weight: '42,000 lb', equip: 'Dry van, 53 ft', temp: 'Ambient', ref: 'PO 55-89902',
    from: 'Bayline LA Annex', fromAddr: '5200 S Boyle Ave, Vernon, CA', to: 'Sunset Beverage DC', toAddr: '3900 W Cheyenne Ave, North Las Vegas, NV', carrier: 'Sunridge Freight (own fleet)', carrierMc: 'MC 812044', carrierDot: 'DOT 2291176' },
  { id: 'L-40210', customer: 'Sierra Ag Partners', route: 'Modesto, CA → Denver, CO', pickup: 'Aug 29', delivery: 'Sep 1', driver: 'Tobias Frey', unit: 'T-118 / DV-14', rate: '$4,120', status: 'Delivered', tone: 'gray',
    miles: '1,142', rpm: '$3.61', pay: '$1,030', margin: '$1,904', commodity: 'Almonds', weight: '43,500 lb', equip: 'Dry van, 53 ft', temp: 'Ambient', ref: 'SO 2214',
    from: 'Sierra Ag Huller 3', fromAddr: '1901 Crows Landing Rd, Modesto, CA', to: 'Front Range Foods', toAddr: '5400 Havana St, Denver, CO', carrier: 'Sunridge Freight (own fleet)', carrierMc: 'MC 812044', carrierDot: 'DOT 2291176' },
  { id: 'L-40222', customer: 'Cascade Building Supply', route: 'Redding, CA → Seattle, WA', pickup: 'Sep 5', delivery: 'Sep 6', driver: 'Ana Cortez', unit: 'T-109 / FB-04', rate: '$2,760', status: 'Dispatched', tone: 'gray',
    miles: '578', rpm: '$4.78', pay: '$690', margin: '$1,312', commodity: 'Steel coil', weight: '46,000 lb', equip: 'Flatbed, 48 ft', temp: 'Ambient', ref: 'SO 7802',
    from: 'Cascade Mill', fromAddr: '3400 Airport Rd, Redding, CA', to: 'Duwamish Steel Yard', toAddr: '8100 E Marginal Way S, Seattle, WA', carrier: 'Sunridge Freight (own fleet)', carrierMc: 'MC 812044', carrierDot: 'DOT 2291176' },
];

const ORG_TIME = { timeZone: 'America/Los_Angeles', today: '2026-09-03' };

describe('GET /loads (§3)', () => {
  it('returns the eight board loads in Runtruck1 order with the seeded values and KPIs', async () => {
    const res = await rosa.get('/api/v1/loads').expect(200);
    const rows = res.body.data as LoadListItem[];
    expect(rows.map((r) => r.loadNumber)).toEqual(BOARD_ORDER);
    expect(res.body.meta).toEqual({
      total: 8,
      limit: 100,
      offset: 0,
      summary: { undispatched: 1, inTransit: 1, delivered: 2, needsPod: 1, views: { active: 5, 'needs-pod': 1, delivered: 2, all: 8 } },
    });

    // §3.2 exact DTO values.
    const table = rows.map((r) => [
      r.loadNumber,
      r.status,
      r.customer.name,
      r.reference,
      r.route,
      r.pickupDate,
      r.deliveryDate,
      r.driverName,
      r.unit,
      r.lineHaulCents,
      r.loadedMiles,
      r.ratePerMileCents,
      r.payCents,
      r.marginCents,
      r.equipmentType,
      r.commodity,
      r.weightLb,
      r.temperatureF,
    ]);
    expect(table).toEqual([
      [40218, 'in_transit', 'Northgate Foods', 'PO 88-41207', 'Fresno, CA → Reno, NV', '2026-09-03', '2026-09-04', 'Marcus Hale', 'T-114 / RF-88', 245000, 478, 513, 61200, 121400, 'reefer_53', 'Frozen produce', 41200, -10],
      [40219, 'at_pickup', 'Bayline Distribution', 'PO 55-90114', 'Stockton, CA → Salt Lake City, UT', '2026-09-03', '2026-09-05', 'Dara Whitfield', 'T-107 / DV-51', 318000, 736, 432, 79500, 154000, 'dry_van_53', 'Palletized dry goods', 38500, null],
      [40220, 'delayed', 'Cascade Building Supply', 'SO 7741', 'Sacramento, CA → Boise, ID', '2026-09-02', '2026-09-04', 'Ellis Nakamura', 'T-121 / FB-12', 291000, 602, 483, 72800, 138800, 'flatbed_tarped', 'Lumber', 44000, null],
      [40221, 'needs_driver', 'Harbor Point Retail', 'PO 31-2280', 'Oakland, CA → Portland, OR', '2026-09-04', '2026-09-06', null, null, 354000, 632, 560, null, null, 'dry_van_53', 'Consumer goods', 30100, null],
      [40214, 'needs_pod', 'Northgate Foods', 'PO 88-41190', 'Bakersfield, CA → Phoenix, AZ', '2026-09-01', '2026-09-02', 'Priya Raman', 'T-103 / RF-27', 198000, 389, 509, 49500, 98600, 'reefer_53', 'Dairy', 36800, 34],
      [40212, 'delivered', 'Bayline Distribution', 'PO 55-89902', 'Los Angeles, CA → Las Vegas, NV', '2026-08-31', '2026-09-01', 'Marcus Hale', 'T-114 / DV-88', 164000, 271, 605, 41000, 84200, 'dry_van_53', 'Beverages', 42000, null],
      [40210, 'delivered', 'Sierra Ag Partners', 'SO 2214', 'Modesto, CA → Denver, CO', '2026-08-29', '2026-09-01', 'Tobias Frey', 'T-118 / DV-14', 412000, 1142, 361, 103000, 190400, 'dry_van_53', 'Almonds', 43500, null],
      [40222, 'dispatched', 'Cascade Building Supply', 'SO 7802', 'Redding, CA → Seattle, WA', '2026-09-05', '2026-09-06', 'Ana Cortez', 'T-109 / FB-04', 276000, 578, 478, 69000, 131200, 'flatbed_48', 'Steel coil', 46000, null],
    ]);

    for (const r of rows) {
      expect(r).toMatchObject({ mode: null, ltl: null, carrierRateCents: null, driverInstructions: null, createdActivityAt: null, payKind: 'driver_pay', totalCents: r.lineHaulCents });
      expect(r.stops.map((s) => s.kind)).toEqual(['pickup', 'fuel', 'delivery']);
      if (r.loadNumber === 40221) expect(r.carrier).toBeNull();
      else expect(r.carrier).toMatchObject({ name: 'Sunridge Freight', mcNumber: '812044', dotNumber: '2291176', isOwnFleet: true });
    }
    const first = rows[0]!;
    expect(first.origin).toEqual({ facilityName: 'Northgate Cold Storage', address: '4120 S Golden State Blvd, Fresno, CA' });
    expect(first.destination).toEqual({ facilityName: 'Reno Grocers DC', address: '1855 E Greg St, Sparks, NV' });
    expect(first.stops[1]).toMatchObject({ facilityName: 'Planned · 92 gal, DEF top-off', addressLabel: 'Routed automatically on the lane', appointmentDate: '2026-09-03', windowOpen: '16:40', windowClose: null });
    expect(first.stops[0]).toMatchObject({ status: 'completed', windowOpen: '08:00', windowClose: '14:00', timezone: 'America/Los_Angeles' });
    // No uuid-like id in the payload leaks a storage key or organization.
    expect(JSON.stringify(res.body)).not.toContain(demo);
  });

  it('renders Runtruck1’s exact strings through the shared view-model (§8.1.2–§8.1.3)', async () => {
    const rows = (await rosa.get('/api/v1/loads?view=all&limit=500').expect(200)).body.data as LoadListItem[];
    const views = rows.map((r) => toLoadSearchRow(r, ORG_TIME));
    expect(views.map(({ stops: _stops, load: _load, ...strings }) => strings)).toEqual(RUNTRUCK1_LOADS);
    // The expand row's stops (Runtruck1 stopsOf): pickup and delivery with their windows.
    for (const [i, v] of views.entries()) {
      const r1 = RUNTRUCK1_LOADS[i]!;
      expect(boardStops(v.stops).map((s) => [s.kind, s.facilityName, s.addressLabel ?? '', stopTimeLine(s)])).toEqual([
        ['pickup', r1.from, r1.fromAddr, `${r1.pickup} · 08:00–14:00`],
        ['delivery', r1.to, r1.toAddr, `${r1.delivery} · 06:00–12:00`],
      ]);
    }
  });

  it('filters by view without changing the KPIs', async () => {
    const active = await rosa.get('/api/v1/loads?view=active').expect(200);
    expect(active.body.data.map((r: LoadListItem) => r.loadNumber)).toEqual([40218, 40219, 40220, 40221, 40222]);
    expect(active.body.meta.total).toBe(5);
    expect(active.body.meta.summary.views.all).toBe(8);
    const pod = await rosa.get('/api/v1/loads?view=needs-pod').expect(200);
    expect(pod.body.data.map((r: LoadListItem) => r.loadNumber)).toEqual([40214]);
    const delivered = await rosa.get('/api/v1/loads?view=delivered').expect(200);
    expect(delivered.body.data.map((r: LoadListItem) => r.loadNumber)).toEqual([40212, 40210]);
  });

  it('pages in SQL and keeps the total', async () => {
    const res = await rosa.get('/api/v1/loads?limit=3&offset=2').expect(200);
    expect(res.body.data.map((r: LoadListItem) => r.loadNumber)).toEqual([40220, 40221, 40214]);
    expect(res.body.meta).toMatchObject({ total: 8, limit: 3, offset: 2 });
    const beyond = await rosa.get('/api/v1/loads?offset=50').expect(200);
    expect(beyond.body.data).toEqual([]);
    expect(beyond.body.meta.total).toBe(8);
  });

  it('matches q over the Runtruck1 display strings (gaps §5 #29)', async () => {
    const sunridge = await rosa.get('/api/v1/loads?q=sunridge').expect(200);
    expect(sunridge.body.data.map((r: LoadListItem) => r.loadNumber)).toEqual([40218, 40219, 40220, 40214, 40212, 40210, 40222]);
    expect(sunridge.body.meta.total).toBe(7);
    expect(sunridge.body.meta.summary.views.all).toBe(8);
    const po = await rosa.get('/api/v1/loads?q=PO%2088').expect(200);
    expect(po.body.data.map((r: LoadListItem) => r.loadNumber)).toEqual([40218, 40214]);
    const money = await rosa.get('/api/v1/loads?q=$1,214').expect(200);
    expect(money.body.data.map((r: LoadListItem) => r.loadNumber)).toEqual([40218]);
    const delivered = await rosa.get('/api/v1/loads?q=delivered&view=active').expect(200);
    expect(delivered.body.data).toEqual([]);
    const today = await rosa.get('/api/v1/loads?q=today').expect(200);
    expect(today.body.meta.total).toBe(0);
    const paged = await rosa.get('/api/v1/loads?q=sunridge&limit=2&offset=1').expect(200);
    expect(paged.body.data.map((r: LoadListItem) => r.loadNumber)).toEqual([40219, 40220]);
    expect(paged.body.meta.total).toBe(7);
  });

  it('refuses bad queries with 400', async () => {
    for (const qs of ['view=bogus', 'limit=501', 'limit=0', 'offset=-1', `q=${'x'.repeat(201)}`]) {
      const res = await rosa.get(`/api/v1/loads?${qs}`).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('needs a session and loads.view', async () => {
    expect((await request(t.server).get('/api/v1/loads').expect(401)).body.error.code).toBe('UNAUTHORIZED');
    expect((await driver.get('/api/v1/loads').expect(403)).body.error.code).toBe('FORBIDDEN');
  });

  it('never shows another organization’s loads', async () => {
    const res = await other.get('/api/v1/loads').expect(200);
    expect(res.body.data.map((r: LoadListItem) => r.loadNumber)).toEqual([OTHER_ORG_FIXTURE.loadNumber]);
    expect(res.body.meta.summary.views.all).toBe(1);
    const search = await other.get('/api/v1/loads?q=northgate').expect(200);
    expect(search.body.data).toEqual([]);
  });
});

describe('load detail (§4)', () => {
  it('returns L-40218 by number with stops, dispatch, documents and activity', async () => {
    const res = await rosa.get('/api/v1/loads/by-number/40218').expect(200);
    const d = res.body.data as LoadDetail;
    expect(res.body.meta).toEqual({});
    expect(d).toMatchObject({
      loadNumber: 40218,
      status: 'in_transit',
      route: 'Fresno, CA → Reno, NV',
      billToCustomer: null,
      tenderRef: 'PO 88-41207',
      customerPo: null,
      hazmat: false,
      ltl: null,
      fuelSurchargeCents: 0,
      accessorialCents: 0,
      emptyMiles: 40,
      driverPayCents: 61200,
      operatingCostCents: 62400,
      paymentTerms: 'net_30',
      archivedAt: null,
      createdBy: null,
      dispatch: { status: 'assigned', driverName: 'Marcus Hale', truckUnit: 'T-114', trailerUnit: 'RF-88', assignedBy: null },
    });
    expect(d.stops.map((s) => [s.sequence, s.kind, s.status, s.facilityName, s.windowOpen, s.windowClose])).toEqual([
      [1, 'pickup', 'completed', 'Northgate Cold Storage', '08:00', '14:00'],
      [2, 'fuel', 'pending', 'Planned · 92 gal, DEF top-off', '16:40', null],
      [3, 'delivery', 'pending', 'Reno Grocers DC', '06:00', '12:00'],
    ]);
    expect(d.documents!.map((doc) => [doc.documentType, doc.status, doc.position, doc.currentVersion?.fileName ?? null])).toEqual([
      ['rate_confirmation', 'attached', 1, 'rate-confirmation-L-40218.pdf'],
      ['bill_of_lading', 'pending', 2, null],
      ['proof_of_delivery', 'pending', 3, null],
    ]);
    expect(d.activity.map((a) => [a.occurredAt, a.kind, a.message, a.actor])).toEqual([
      ['2026-09-03T14:12:00.000Z', 'driver_accepted', 'Driver accepted the load in the app', null],
      ['2026-09-03T15:41:00.000Z', 'arrived', 'Arrived at Northgate Cold Storage', null],
      ['2026-09-03T17:05:00.000Z', 'document_uploaded', 'Bill of lading uploaded from the cab', null],
      ['2026-09-03T17:06:00.000Z', 'consignee_notified', 'Dispatch notified the consignee', null],
    ]);
    const byId = await rosa.get(`/api/v1/loads/${d.id}`).expect(200);
    expect(byId.body.data).toEqual(d);
  });

  it('reproduces the per-load stop, document and activity matrix (core-pages §4.3)', async () => {
    const expectations: Record<number, { pickup: string; delivery: string; docs: string[]; last: string }> = {
      40219: { pickup: 'arrived', delivery: 'pending', docs: ['attached', 'pending', 'pending'], last: 'Dispatch notified the consignee' },
      40221: { pickup: 'completed', delivery: 'pending', docs: ['attached', 'pending', 'pending'], last: 'Dispatch notified the consignee' },
      40214: { pickup: 'completed', delivery: 'pending', docs: ['attached', 'attached', 'pending'], last: 'Dispatch notified the consignee' },
      40212: { pickup: 'completed', delivery: 'completed', docs: ['attached', 'attached', 'attached'], last: 'Invoice queued for billing' },
    };
    for (const [n, e] of Object.entries(expectations)) {
      const d = (await rosa.get(`/api/v1/loads/by-number/${n}`).expect(200)).body.data as LoadDetail;
      expect(d.stops[0]!.status).toBe(e.pickup);
      expect(d.stops[2]!.status).toBe(e.delivery);
      expect(d.documents!.map((x) => x.status)).toEqual(e.docs);
      expect(d.activity[3]!.message).toBe(e.last);
    }
    const l40221 = (await rosa.get('/api/v1/loads/by-number/40221').expect(200)).body.data as LoadDetail;
    expect(l40221.dispatch).toBeNull();
    expect(l40221.carrier).toBeNull();
  });

  it('renders the detail page strings of every seeded load (core-pages §4.3; D7 time line)', async () => {
    for (const r1 of RUNTRUCK1_LOADS) {
      const d = (await rosa.get(`/api/v1/loads/by-number/${r1.id.slice(2)}`).expect(200)).body.data as LoadDetail;
      const delivered = r1.status === 'Delivered';
      expect(d.stops.map((s) => [stopKindLabel(s.kind, s.status), stopKindClass(s.kind), s.facilityName, s.addressLabel ?? '', stopTimeLine(s)])).toEqual([
        [r1.status === 'At pickup' ? 'Pickup · at shipper' : 'Pickup · complete', 'pickup', r1.from, r1.fromAddr, `${r1.pickup} · 08:00–14:00`],
        ['Fuel stop', '', 'Planned · 92 gal, DEF top-off', 'Routed automatically on the lane', `${r1.pickup} · 16:40`],
        [delivered ? 'Delivery · complete' : 'Delivery', 'delivery', r1.to, r1.toAddr, `${r1.delivery} · 06:00–12:00`],
      ]);
      expect(d.documents!.map((doc) => [LOAD_DOCUMENT_TYPE_LABEL[doc.documentType], LOAD_DOCUMENT_STATUS_LABEL[doc.status]])).toEqual([
        ['Rate confirmation', 'Attached'],
        ['Bill of lading', delivered || r1.status === 'Needs POD' ? 'Attached' : 'Pending'],
        ['Proof of delivery', delivered ? 'Attached' : 'Pending'],
      ]);
      expect(d.activity.map((a) => [formatActivityTime(a.occurredAt, ORG_TIME.timeZone, ORG_TIME.today), a.message])).toEqual([
        ['Today 07:12', 'Driver accepted the load in the app'],
        ['Today 08:41', `Arrived at ${r1.from}`],
        ['Today 10:05', 'Bill of lading uploaded from the cab'],
        ['Today 10:06', delivered ? 'Invoice queued for billing' : 'Dispatch notified the consignee'],
      ]);
      // KPI 3 reads "Driver pay" on every seeded load (no carrier rate).
      expect(d.payKind).toBe('driver_pay');
    }
  });

  it('resolves archived loads, with and without stops (L1)', async () => {
    const archived = (await rosa.get('/api/v1/loads/by-number/40209').expect(200)).body.data as LoadDetail;
    expect(archived).toMatchObject({
      loadNumber: 40209,
      status: 'delivered',
      archivedAt: '2026-09-03T07:00:00.000Z',
      route: 'Fresno, CA → Reno, NV',
      carrier: null,
      dispatch: null,
      equipmentType: null,
      commodity: null,
      weightLb: null,
      activity: [],
    });
    expect(archived.stops.map((s) => s.status)).toEqual(['completed', 'completed']);
    expect(archived.documents!.map((x) => [x.documentType, x.status])).toEqual([['proof_of_delivery', 'attached']]);
    const bare = (await rosa.get('/api/v1/loads/by-number/40198').expect(200)).body.data as LoadDetail;
    expect(bare.stops).toEqual([]);
    expect(bare.route).toBeNull();
    expect(bare.documents).toEqual([]);
  });

  it('omits the documents without documents.view (07 §8 item 1)', async () => {
    const res = await viewOnly.get('/api/v1/loads/by-number/40218').expect(200);
    expect(res.body.data.documents).toBeNull();
    expect(res.body.data.activity).toHaveLength(4);
  });

  it('answers 404 for unknown and foreign loads, 400 for malformed keys', async () => {
    expect((await rosa.get('/api/v1/loads/by-number/99999').expect(404)).body.error).toMatchObject({ code: 'LOAD_NOT_FOUND', message: 'Load was not found.' });
    await rosa.get(`/api/v1/loads/by-number/${OTHER_ORG_FIXTURE.loadNumber}`).expect(404);
    await other.get('/api/v1/loads/by-number/40218').expect(404);
    const l40218 = (await rosa.get('/api/v1/loads/by-number/40218').expect(200)).body.data as LoadDetail;
    expect((await other.get(`/api/v1/loads/${l40218.id}`).expect(404)).body.error.code).toBe('LOAD_NOT_FOUND');
    await rosa.get('/api/v1/loads/00000000-0000-4000-8000-000000000000').expect(404);
    for (const key of ['L-40218', '0', '040218', 'abc', '99999999999']) {
      expect((await rosa.get(`/api/v1/loads/by-number/${key}`).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await rosa.get('/api/v1/loads/not-a-uuid').expect(400)).body.error.code).toBe('VALIDATION_ERROR');
  });

  it('needs a session and loads.view', async () => {
    await request(t.server).get('/api/v1/loads/by-number/40218').expect(401);
    await request(t.server).get('/api/v1/loads/00000000-0000-4000-8000-000000000000').expect(401);
    await driver.get('/api/v1/loads/by-number/40218').expect(403);
    await driver.get('/api/v1/loads/00000000-0000-4000-8000-000000000000').expect(403);
  });
});

describe('POST /loads (§6)', () => {
  let exampleA: Record<string, unknown>;

  beforeAll(async () => {
    exampleA = {
      customerId: await customerId(demo, 'Northgate Foods'),
      billToCustomerId: await customerId(demo, 'Northgate Foods'),
      tenderRef: '',
      customerPo: '',
      mode: 'ftl',
      equipmentType: 'reefer_53',
      dispatcherName: 'Rosa Medina',
      stops: [
        {
          kind: 'pickup',
          facilityName: 'Northgate Cold Storage',
          addressLine1: '4120 S Golden State Blvd',
          city: 'Fresno',
          state: 'ca',
          postalCode: '93725',
          appointmentDate: '2026-09-05',
          windowOpen: '08:00',
          windowClose: '12:00',
          referenceNumber: '',
          siteContact: '',
        },
        { kind: 'delivery', facilityName: 'Reno Grocers DC', addressLine1: '1855 E Greg St', city: 'Sparks', state: 'NV', postalCode: '89431', appointmentDate: '2026-09-06', windowOpen: '06:00', windowClose: null },
      ],
      commodity: 'Frozen produce',
      weightLb: 41200,
      pieces: null,
      packaging: 'pallets',
      declaredValueCents: null,
      temperatureF: -10,
      hazmat: false,
      unNumber: null,
      ltl: null,
      haul: {
        hauledBy: 'own_fleet',
        driverId: await driverId(demo, 'Priya Raman'),
        truckId: await truckId(demo, 'T-103'),
        trailerId: await trailerId(demo, 'RF-09'),
        driverPayCents: 61200,
      },
      lineHaulCents: 245000,
      fuelSurchargeCents: 18000,
      accessorialCents: 7500,
      loadedMiles: 478,
      paymentTerms: 'net_30',
      driverInstructions: 'Check in at gate 3',
      internalNotes: '',
    };
  });

  it('creates worked example A (own fleet, FTL, reefer) as L-40223 with audit and events', async () => {
    const res = await rosa.post('/api/v1/loads').send(exampleA).expect(201);
    const d = res.body.data as LoadDetail;
    expect(res.body.meta).toEqual({});
    expect(d).toMatchObject({
      loadNumber: 40223,
      status: 'dispatched',
      route: 'Fresno, CA → Sparks, NV',
      pickupDate: '2026-09-05',
      deliveryDate: '2026-09-06',
      driverName: 'Priya Raman',
      unit: 'T-103 / RF-09',
      carrier: { name: 'Sunridge Freight', isOwnFleet: true },
      mode: 'ftl',
      totalCents: 270500,
      ratePerMileCents: 513,
      payKind: 'driver_pay',
      payCents: 61200,
      marginCents: 209300,
      reference: null,
      temperatureF: -10,
      driverInstructions: 'Check in at gate 3',
      dispatcherName: 'Rosa Medina',
      internalNotes: null,
      billToCustomer: { name: 'Northgate Foods' },
      createdBy: { fullName: 'Rosa Medina' },
      archivedAt: null,
      dispatch: { status: 'assigned', driverName: 'Priya Raman', truckUnit: 'T-103', trailerUnit: 'RF-09', assignedBy: { fullName: 'Rosa Medina' } },
    });
    expect(d.stops.map((s) => [s.addressLabel, s.state, s.status, s.timezone, s.facilityId])).toEqual([
      ['4120 S Golden State Blvd, Fresno, CA 93725', 'CA', 'pending', 'America/Los_Angeles', null],
      ['1855 E Greg St, Sparks, NV 89431', 'NV', 'pending', 'America/Los_Angeles', null],
    ]);
    expect(d.documents!.map((x) => [x.documentType, x.status, x.position])).toEqual([
      ['rate_confirmation', 'pending', 1],
      ['customer_load_tender', 'pending', 2],
      ['bill_of_lading', 'pending', 3],
      ['proof_of_delivery', 'pending', 4],
      ['lumper_receipt', 'pending', 5],
    ]);
    expect(d.activity.map((a) => [a.kind, a.message, a.actor?.fullName])).toEqual([
      ['created', 'Load created by Rosa Medina', 'Rosa Medina'],
      ['driver_instructions', 'Driver instructions: Check in at gate 3', 'Rosa Medina'],
    ]);
    // Business instants use the demo clock (2026-09-03, real time of day).
    expect(d.createdActivityAt).toBe(d.activity[0]!.occurredAt);
    expect(d.activity[0]!.occurredAt.startsWith('2026-09-0')).toBe(true);

    // Audit: LOAD_CREATED and LOAD_ASSIGNED, each recording Priya Raman's expired CDL (C27).
    const audit = await auditRows(d.id);
    expect(audit.map((a) => a.action).sort()).toEqual(['LOAD_ASSIGNED', 'LOAD_CREATED']);
    const created = audit.find((a) => a.action === 'LOAD_CREATED')!;
    const priya = await driverId(demo, 'Priya Raman');
    const cdlWarning = { driverId: priya, documentType: 'cdl', problem: 'expired', expiresOn: '2026-07-31', message: 'CDL expired on 2026-07-31.' };
    expect(created).toMatchObject({ entityType: 'load', entityLabel: 'L-40223' });
    expect(created.next).toEqual({
      loadNumber: 40223,
      status: 'dispatched',
      customerId: exampleA.customerId,
      billToCustomerId: exampleA.billToCustomerId,
      carrierId: d.carrier!.id,
      lineHaulCents: 245000,
      fuelSurchargeCents: 18000,
      accessorialCents: 7500,
      stopCount: 2,
      complianceWarnings: [cdlWarning],
    });
    const assigned = audit.find((a) => a.action === 'LOAD_ASSIGNED')!;
    expect(assigned.next).toEqual({
      carrierId: d.carrier!.id,
      dispatchId: d.dispatch!.id,
      driverId: priya,
      truckId: d.dispatch!.truckId,
      trailerId: d.dispatch!.trailerId,
      driverName: null,
      truckNumber: null,
      trailerNumber: null,
      complianceWarnings: [cdlWarning],
    });

    const events = await eventRows(d.id);
    expect(events.map((e) => e.type).sort()).toEqual(['LoadAssigned', 'LoadCreated', 'LoadDispatched']);
    expect(events.every((e) => e.aggregateType === 'load' && e.organizationId === demo)).toBe(true);
    expect(events.find((e) => e.type === 'LoadCreated')!.payload).toEqual({ loadId: d.id, loadNumber: 40223, status: 'dispatched' });
    expect(events.find((e) => e.type === 'LoadDispatched')!.payload).toEqual({ loadId: d.id, loadNumber: 40223 });
    expect(events.find((e) => e.type === 'LoadAssigned')!.payload).toEqual({
      loadId: d.id,
      dispatchId: d.dispatch!.id,
      carrierId: d.carrier!.id,
      driverId: priya,
      truckId: d.dispatch!.truckId,
      trailerId: d.dispatch!.trailerId,
    });

    // It tops the board, and the KPIs count it.
    const board = await rosa.get('/api/v1/loads').expect(200);
    expect(board.body.data[0].loadNumber).toBe(40223);
    expect(board.body.data[0].createdActivityAt).toBe(d.createdActivityAt);
    expect(board.body.meta.summary.views).toEqual({ active: 6, 'needs-pod': 1, delivered: 2, all: 9 });
    const today = await rosa.get('/api/v1/loads?q=today').expect(200);
    expect(today.body.data.map((r: LoadListItem) => r.loadNumber)).toEqual([40223]);
  });

  it('creates worked example B (partner carrier, LTL, negative margin)', async () => {
    const body = {
      customerId: await customerId(demo, 'Bayline Distribution'),
      billToCustomerId: null,
      tenderRef: 'PO 55-90200',
      mode: 'ltl',
      equipmentType: 'dry_van_53',
      dispatcherName: 'Rosa Medina',
      stops: [
        { kind: 'pickup', facilityName: 'Bayline DC 4', addressLine1: '2900 Navy Dr', city: 'Stockton', state: 'CA', postalCode: '', appointmentDate: '2026-09-04', windowOpen: null, windowClose: null },
        { kind: 'delivery', facilityName: 'Wasatch Crossdock', addressLine1: '1740 S 4130 W', city: 'Salt Lake City', state: 'UT', postalCode: '84104', appointmentDate: '2026-09-06', windowOpen: null, windowClose: '14:00' },
      ],
      commodity: 'Palletized dry goods',
      weightLb: 6200,
      packaging: 'pallets',
      hazmat: false,
      ltl: { freightClass: '70', nmfc: null, handlingUnits: 4, lengthIn: null, widthIn: null, heightIn: null, stackable: false, services: ['liftgate_delivery', 'delivery_appointment'] },
      haul: {
        hauledBy: 'partner_carrier',
        carrierId: await carrierId(demo, 'Valley Line Transport'),
        carrierRateCents: 150000,
        carrierContactName: '',
        carrierPhone: '',
        driverName: '',
        truckNumber: '',
        trailerNumber: '',
      },
      lineHaulCents: 120000,
      fuelSurchargeCents: 10000,
      accessorialCents: 0,
      loadedMiles: null,
      paymentTerms: 'net_30',
      driverInstructions: null,
      internalNotes: null,
    };
    const d = (await rosa.post('/api/v1/loads').send(body).expect(201)).body.data as LoadDetail;
    expect(d).toMatchObject({
      loadNumber: 40224,
      status: 'dispatched',
      route: 'Stockton, CA → Salt Lake City, UT',
      driverName: null,
      unit: null,
      dispatch: null,
      ratePerMileCents: null,
      payKind: 'carrier_cost',
      payCents: 150000,
      marginCents: -20000,
      carrierRateCents: 150000,
      driverPayCents: null,
      carrier: { name: 'Valley Line Transport', mcNumber: '604117', dotNumber: '1780342', isOwnFleet: false },
      reference: 'PO 55-90200',
      ltl: { freightClass: '70', handlingUnits: 4, packaging: 'pallets', services: ['liftgate_delivery', 'delivery_appointment'], nmfc: null, stackable: false },
    });
    expect(d.stops.map((s) => [s.addressLabel, s.windowOpen, s.windowClose])).toEqual([
      ['2900 Navy Dr, Stockton, CA', null, null],
      ['1740 S 4130 W, Salt Lake City, UT 84104', null, '14:00'],
    ]);
    expect(d.activity.map((a) => a.message)).toEqual(['Load created by Rosa Medina']);
    const events = await eventRows(d.id);
    expect(events.map((e) => e.type).sort()).toEqual(['LoadAssigned', 'LoadCreated', 'LoadDispatched']);
    expect(events.find((e) => e.type === 'LoadAssigned')!.payload).toMatchObject({ dispatchId: null, driverId: null, carrierId: d.carrier!.id });
    const audit = await auditRows(d.id);
    expect(audit.find((a) => a.action === 'LOAD_CREATED')!.next).not.toHaveProperty('complianceWarnings');
  });

  it('puts an own-fleet load without a driver on the board as needs_driver (own fleet shown)', async () => {
    const body = { ...exampleA, haul: { hauledBy: 'own_fleet', driverId: null, truckId: null, trailerId: null, driverPayCents: 0 }, driverInstructions: null };
    const d = (await createOnly.post('/api/v1/loads').send(body).expect(201)).body.data as LoadDetail;
    expect(d).toMatchObject({ loadNumber: 40225, status: 'needs_driver', driverName: null, unit: null, dispatch: null, payCents: null, marginCents: null, carrier: { isOwnFleet: true } });
    // createOnly lacks documents.view: the created load is read back without the list.
    expect(d.documents).toBeNull();
    const audit = await auditRows(d.id);
    expect(audit.map((a) => a.action)).toEqual(['LOAD_CREATED']);
    expect((await eventRows(d.id)).map((e) => e.type)).toEqual(['LoadCreated']);
  });

  it('refuses an assignment without loads.assign (S1) and a create without loads.create', async () => {
    const res = await createOnly.post('/api/v1/loads').send(exampleA).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    const partner = await createOnly
      .post('/api/v1/loads')
      .send({ ...exampleA, haul: { hauledBy: 'partner_carrier', carrierId: await carrierId(demo, 'Valley Line Transport'), carrierRateCents: 1 }, temperatureF: null, equipmentType: 'dry_van_53' })
      .expect(403);
    expect(partner.body.error.code).toBe('FORBIDDEN');
    expect((await accounting.post('/api/v1/loads').send(exampleA).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await driver.post('/api/v1/loads').send(exampleA).expect(403)).body.error.code).toBe('FORBIDDEN');
    await request(t.server).post('/api/v1/loads').send(exampleA).expect(401);
    expect((await rosa.post('/api/v1/loads').set('Origin', 'https://evil.example').send(exampleA).expect(403)).body.error.code).toBe('CROSS_ORIGIN_REJECTED');
  });

  it('returns Runtruck1’s 11 issues, in order, for a fresh draft', async () => {
    const res = await rosa
      .post('/api/v1/loads')
      .send({ mode: 'ftl', stops: [{ kind: 'pickup' }, { kind: 'delivery' }], haul: { hauledBy: 'own_fleet' }, paymentTerms: 'net_30' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.issues).toEqual([
      { path: 'customerId', message: 'Customer' },
      { path: 'equipmentType', message: 'Equipment' },
      { path: 'stops.0.facilityName', message: 'Stop 1: facility' },
      { path: 'stops.0.address', message: 'Stop 1: street, city and state' },
      { path: 'stops.0.appointmentDate', message: 'Stop 1: date' },
      { path: 'stops.1.facilityName', message: 'Stop 2: facility' },
      { path: 'stops.1.address', message: 'Stop 2: street, city and state' },
      { path: 'stops.1.appointmentDate', message: 'Stop 2: date' },
      { path: 'commodity', message: 'Commodity' },
      { path: 'weightLb', message: 'Weight' },
      { path: 'lineHaulCents', message: 'Line haul rate' },
    ]);
  });

  it('refuses bad shapes and bounds with field issues', async () => {
    const neg = await rosa.post('/api/v1/loads').send({ ...exampleA, fuelSurchargeCents: -100 }).expect(400);
    expect(neg.body.error.issues).toContainEqual({ path: 'fuelSurchargeCents', message: "Fuel surcharge can't be negative." });
    const total = await rosa.post('/api/v1/loads').send({ ...exampleA, lineHaulCents: 2_147_483_000, fuelSurchargeCents: 1_000 }).expect(400);
    expect(total.body.error.issues).toContainEqual({ path: 'lineHaulCents', message: 'Total to customer is too large.' });
    const hidden = await rosa.post('/api/v1/loads').send({ ...exampleA, equipmentType: 'dry_van_53' }).expect(400);
    expect(hidden.body.error.issues).toContainEqual({ path: 'temperatureF', message: 'A temperature is recorded only for reefer equipment.' });
    const date = await rosa.post('/api/v1/loads').send({ ...exampleA, stops: [(exampleA.stops as object[])[0], { ...(exampleA.stops as object[])[1]!, appointmentDate: '2026-09-01' }] }).expect(400);
    expect(date.body.error.issues).toEqual([{ path: 'stops.1.appointmentDate', message: 'Stop 2: date is before stop 1' }]);
    const tooMany = await rosa.post('/api/v1/loads').send({ ...exampleA, stops: Array.from({ length: 51 }, () => (exampleA.stops as object[])[0]) }).expect(400);
    expect(tooMany.body.error.issues[0]).toEqual({ path: 'stops', message: 'A load has at most 50 stops.' });
    await rosa.post('/api/v1/loads').send({ ...exampleA, haul: { hauledBy: 'drone' } }).expect(400);
  });

  it('answers foreign and unknown references with the same 400 issue (S2–S4, L7)', async () => {
    const otherOrg = t.orgs.otherOrganizationId;
    const foreignCustomer = await customerId(otherOrg, OTHER_ORG_FIXTURE.customerName);
    const res = await rosa
      .post('/api/v1/loads')
      .send({
        ...exampleA,
        customerId: foreignCustomer,
        billToCustomerId: '00000000-0000-4000-8000-000000000001',
        haul: { hauledBy: 'own_fleet', driverId: await driverId(otherOrg, OTHER_ORG_FIXTURE.driverName), truckId: await truckId(otherOrg, OTHER_ORG_FIXTURE.truckUnit), trailerId: '00000000-0000-4000-8000-000000000002', driverPayCents: null },
      })
      .expect(400);
    expect(res.body.error.issues).toEqual([
      { path: 'customerId', message: 'Customer was not found.' },
      { path: 'billToCustomerId', message: 'Customer was not found.' },
      { path: 'haul.driverId', message: 'Driver was not found.' },
      { path: 'haul.truckId', message: 'Truck was not found.' },
      { path: 'haul.trailerId', message: 'Trailer was not found.' },
    ]);
    const own = await rosa
      .post('/api/v1/loads')
      .send({ ...exampleA, temperatureF: null, equipmentType: 'dry_van_53', haul: { hauledBy: 'partner_carrier', carrierId: await carrierId(demo, 'Sunridge Freight'), carrierRateCents: 1000 } })
      .expect(400);
    expect(own.body.error.issues).toEqual([{ path: 'haul.carrierId', message: 'Choose a partner carrier.' }]);
    const foreignCarrier = await rosa
      .post('/api/v1/loads')
      .send({ ...exampleA, temperatureF: null, equipmentType: 'dry_van_53', haul: { hauledBy: 'partner_carrier', carrierId: await carrierId(otherOrg, OTHER_ORG_FIXTURE.carrierName), carrierRateCents: 1000 } })
      .expect(400);
    expect(foreignCarrier.body.error.issues).toEqual([{ path: 'haul.carrierId', message: 'Carrier was not found.' }]);
  });

  it('refuses an inactive driver (E5)', async () => {
    const ana = await driverId(demo, 'Ana Cortez');
    const [row] = await db().select({ employeeId: schema.drivers.employeeId }).from(schema.drivers).where(eq(schema.drivers.id, ana));
    await db().update(schema.employees).set({ status: 'onboarding' }).where(eq(schema.employees.id, row!.employeeId));
    try {
      const res = await rosa.post('/api/v1/loads').send({ ...exampleA, haul: { hauledBy: 'own_fleet', driverId: ana, truckId: null, trailerId: null, driverPayCents: null } }).expect(400);
      expect(res.body.error.issues).toEqual([{ path: 'haul.driverId', message: 'This driver is not active.' }]);
    } finally {
      await db().update(schema.employees).set({ status: 'active' }).where(eq(schema.employees.id, row!.employeeId));
    }
  });

  it('writes nothing when a create is refused', async () => {
    const [before] = await db().select({ n: schema.organizationCounters.nextValue }).from(schema.organizationCounters).where(and(eq(schema.organizationCounters.organizationId, demo), eq(schema.organizationCounters.key, 'load')));
    expect(before!.n).toBe(40226);
    const board = await rosa.get('/api/v1/loads').expect(200);
    expect(board.body.meta.summary.views.all).toBe(11);
  });

  it('numbers loads per organization and keeps them in their tenant', async () => {
    const otherOrg = t.orgs.otherOrganizationId;
    const body = {
      ...exampleA,
      customerId: await customerId(otherOrg, OTHER_ORG_FIXTURE.customerName),
      billToCustomerId: null,
      haul: { hauledBy: 'own_fleet', driverId: await driverId(otherOrg, OTHER_ORG_FIXTURE.driverName), truckId: null, trailerId: null, driverPayCents: null },
    };
    const d = (await other.post('/api/v1/loads').send(body).expect(201)).body.data as LoadDetail;
    expect(d.loadNumber).toBe(OTHER_ORG_FIXTURE.counters.load);
    expect(d.carrier?.name).toBe(OTHER_ORG_FIXTURE.carrierName);
    expect(d.stops.every((s) => s.timezone === OTHER_ORG_FIXTURE.timezone)).toBe(true);
    await rosa.get(`/api/v1/loads/${d.id}`).expect(404);
    const board = await rosa.get('/api/v1/loads?q=prairie').expect(200);
    expect(board.body.data).toEqual([]);
    const events = await eventRows(d.id);
    expect(events.every((e) => e.organizationId === otherOrg)).toBe(true);
  });

  it('allows the web origin', async () => {
    const res = await rosa.post('/api/v1/loads').set('Origin', WEB_ORIGIN).send({ ...exampleA, haul: { hauledBy: 'own_fleet', driverId: null, truckId: null, trailerId: null, driverPayCents: null } }).expect(201);
    expect(res.body.data.loadNumber).toBe(40226);
  });

  it('records every driver’s compliance problems without blocking (C27)', async () => {
    const warningsFor = async (fullName: string) => {
      const body = { ...exampleA, haul: { hauledBy: 'own_fleet', driverId: await driverId(demo, fullName), truckId: null, trailerId: null, driverPayCents: null }, driverInstructions: null };
      const d = (await rosa.post('/api/v1/loads').send(body).expect(201)).body.data as LoadDetail;
      expect(d.status).toBe('dispatched');
      const audit = await auditRows(d.id);
      const created = audit.find((a) => a.action === 'LOAD_CREATED')!.next as { complianceWarnings: unknown };
      const assigned = audit.find((a) => a.action === 'LOAD_ASSIGNED')!.next as { complianceWarnings: unknown };
      expect(assigned.complianceWarnings).toEqual(created.complianceWarnings);
      return created.complianceWarnings;
    };
    // Marcus Hale: CDL and medical card valid; a clearinghouse query expiring Sep 20 is not a problem.
    expect(await warningsFor('Marcus Hale')).toEqual([]);
    const tobias = await driverId(demo, 'Tobias Frey');
    expect(await warningsFor('Tobias Frey')).toEqual([{ driverId: tobias, documentType: 'drug_test', problem: 'missing', expiresOn: null, message: 'Drug test is missing.' }]);
    // Ana Cortez's file holds no medical card at all.
    const ana = await driverId(demo, 'Ana Cortez');
    expect(await warningsFor('Ana Cortez')).toEqual([{ driverId: ana, documentType: 'medical_card', problem: 'missing', expiresOn: null, message: 'Medical card is missing.' }]);
  });
});
