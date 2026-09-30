import { hashPassword, schema } from '@runtruck/database';
import { OTHER_ORG_FIXTURE } from '@runtruck/database/testing';
import type { Permission } from '@runtruck/permissions';
import type {
  PageMeta,
  PlannerColorCodeDto,
  PlannerColorCodesMeta,
  PlannerEventDto,
  PlannerEventsMeta,
  PlannerRelatedLoadDto,
  PlannerStopValuesDto,
} from '@runtruck/types';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, TEST_PASSWORD, type TestContext } from './helpers.js';

// docs/api/planner.md §9 (reads): the four seed ranges and their order, the §4.1 DTOs, color
// codes, stop values, related loads, `q`, validation, permissions and tenant isolation.
// Writes, Reset and the audit trail are in planner-writes.int.test.ts.

type Agent = ReturnType<typeof request.agent>;

let t: TestContext;
let rosa: Agent;
let accounting: Agent;
let driver: Agent;
let other: Agent;
let viewOnly: Agent;
let manageNoLoads: Agent;
let demo: string;

const db = () => t.db.db;

// A member of the demo organization whose role holds exactly `permissions`.
async function customMember(key: string, memberNumber: string, permissions: Permission[]): Promise<Agent> {
  const email = `${key}@sunridgefreight.test`;
  const [role] = await db()
    .insert(schema.roles)
    .values({ organizationId: demo, key: `custom_${key}`, name: key })
    .returning({ id: schema.roles.id });
  const perms = await db()
    .select({ id: schema.permissions.id })
    .from(schema.permissions)
    .where(inArray(schema.permissions.key, permissions));
  await db()
    .insert(schema.rolePermissions)
    .values(perms.map((p) => ({ roleId: role!.id, permissionId: p.id })));
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

beforeAll(async () => {
  t = await createTestContext();
  demo = t.orgs.demoOrganizationId;
  rosa = await t.as('admin');
  accounting = await t.as('accounting');
  driver = await t.as('driver');
  other = await t.as('otherAdmin');
  viewOnly = await customMember('planner_view', '100482790', ['planner.view']);
  manageNoLoads = await customMember('planner_manage', '100482791', ['planner.view', 'planner.manage']);
});
afterAll(async () => {
  await t.close();
});

interface Envelope<T, M> {
  data: T;
  meta: M;
}

async function get<T, M = Record<string, never>>(path: string, agent: Agent = rosa): Promise<Envelope<T, M>> {
  const res = await agent.get(`/api/v1${path}`).expect(200);
  return res.body as Envelope<T, M>;
}

const events = (range: string, agent: Agent = rosa) => get<PlannerEventDto[], PlannerEventsMeta>(`/planner/events?${range}`, agent);

const WEEK = 'from=2026-08-31&to=2026-09-06';
const STANDUP = 'Dispatch standup';
const EV = [
  'Tobias Frey — home time',
  'T-118 in shop — turbo',
  'Payroll review — week of Sep 1',
  'Invoice batch B-2034 review',
  'FB-12 DOT annual inspection',
  'Road test — Sofia Nguyen',
  'T-114 PM service A',
  'Labor Day — office closed',
  'Orientation — Jamal Reed',
  'Safety meeting — HOS refresher',
  'Northgate Foods quarterly review',
  'IFTA Q3 prep',
  'Sierra Ag collections call',
  'Marcus Hale — Clearinghouse query due',
  'Ana Cortez — MVR & annual review due',
];
const BOARD = [40218, 40219, 40220, 40221, 40214, 40212, 40210, 40222];

// §2.5: the week's stop events in board order, pickup before delivery (L-40210's pickup is Aug 29).
const WEEK_STOPS = [
  'L-40218 · Fresno, CA',
  'L-40218 · Reno, NV',
  'L-40219 · Stockton, CA',
  'L-40219 · Salt Lake City, UT',
  'L-40220 · Sacramento, CA',
  'L-40220 · Boise, ID',
  'L-40221 · Oakland, CA',
  'L-40221 · Portland, OR',
  'L-40214 · Bakersfield, CA',
  'L-40214 · Phoenix, AZ',
  'L-40212 · Los Angeles, CA',
  'L-40212 · Las Vegas, NV',
  'L-40210 · Denver, CO',
  'L-40222 · Redding, CA',
  'L-40222 · Seattle, WA',
];

describe('GET /planner/events (§3.1)', () => {
  it('returns the default week in Runtruck1’s `all` order: standups, ev-1 … ev-7, then the stop events', async () => {
    const { data, meta } = await events(WEEK);
    expect(meta).toEqual({ total: 27, limit: 500, offset: 0, from: '2026-08-31', to: '2026-09-06' });
    expect(data.map((e) => [e.title, e.date])).toEqual([
      [STANDUP, '2026-08-31'],
      [STANDUP, '2026-09-01'],
      [STANDUP, '2026-09-02'],
      [STANDUP, '2026-09-03'],
      [STANDUP, '2026-09-04'],
      ...EV.slice(0, 7).map((title, i) => [
        title,
        ['2026-09-01', '2026-09-02', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'][i],
      ]),
      ...WEEK_STOPS.map((title): unknown[] => [title, expect.any(String) as unknown]),
    ]);
    expect(data.slice(0, 12).every((e) => !e.readOnly)).toBe(true);
    expect(data.slice(12).every((e) => e.readOnly)).toBe(true);
  });

  it('returns the Day, September and August ranges of the web (27 / 6 / 52 / 33)', async () => {
    const day = await events('from=2026-09-03&to=2026-09-03');
    expect(day.meta.total).toBe(6);
    expect(day.data.map((e) => e.title)).toEqual([STANDUP, EV[0], EV[1], EV[4], 'L-40218 · Fresno, CA', 'L-40219 · Stockton, CA']);

    const sep = await events('from=2026-08-31&to=2026-10-04');
    expect(sep.meta.total).toBe(52);
    expect(sep.data.filter((e) => !e.readOnly)).toHaveLength(37);
    // The web's month count: start dates in September, stop events included (50).
    expect(sep.data.filter((e) => e.date.startsWith('2026-09'))).toHaveLength(50);

    const aug = await events('from=2026-07-27&to=2026-09-06');
    expect(aug.meta.total).toBe(33);
    expect(aug.data.filter((e) => !e.readOnly)).toHaveLength(17);
    expect(aug.data.filter((e) => e.date.startsWith('2026-08'))).toHaveLength(8);
  });

  it('serves the L-40218 pickup and ev-1 exactly as §4.1', async () => {
    const { data } = await events(WEEK);
    const pickup = data.find((e) => e.title === 'L-40218 · Fresno, CA');
    const [stop] = await db()
      .select({ id: schema.loadStops.id, loadId: schema.loads.id })
      .from(schema.loadStops)
      .innerJoin(schema.loads, eq(schema.loads.id, schema.loadStops.loadId))
      .where(and(eq(schema.loads.organizationId, demo), eq(schema.loads.loadNumber, 40218), eq(schema.loadStops.kind, 'pickup')));
    const codes = new Map((await get<PlannerColorCodeDto[]>('/planner/color-codes')).data.map((c) => [c.key, c.id]));
    expect(pickup).toEqual({
      id: stop!.id,
      readOnly: true,
      title: 'L-40218 · Fresno, CA',
      colorCodeId: codes.get('pickup'),
      colorCodeKey: 'pickup',
      date: '2026-09-03',
      endDate: null,
      start: '10:30',
      end: '12:30',
      timezone: 'America/Los_Angeles',
      place: 'Fresno, CA',
      notes: 'Northgate Cold Storage · Northgate Foods',
      people: ['Marcus Hale'],
      loadId: stop!.loadId,
      loadNumber: 40218,
      facility: 'Northgate Cold Storage',
      customer: 'Northgate Foods',
      driver: 'Marcus Hale',
      truck: 'T-114 / RF-88',
      commodity: 'Frozen produce',
    });
    expect(data.find((e) => e.title === EV[0])).toEqual({
      id: expect.any(String),
      readOnly: false,
      title: 'Tobias Frey — home time',
      colorCodeId: codes.get('driver'),
      colorCodeKey: 'driver',
      date: '2026-09-01',
      endDate: '2026-09-06',
      start: null,
      end: null,
      timezone: 'America/Los_Angeles',
      place: null,
      notes: 'Back on duty Mon Sep 7.',
      people: ['Tobias Frey'],
      loadId: null,
      loadNumber: null,
      facility: null,
      customer: null,
      driver: null,
      truck: null,
      commodity: null,
    });
    // Stop times are the stop's wall clock: Wasatch Crossdock is 08:30 America/Denver.
    expect(data.find((e) => e.title === 'L-40219 · Salt Lake City, UT')).toMatchObject({
      start: '08:30',
      end: '10:30',
      timezone: 'America/Denver',
    });
    // L-40221 has no dispatch: "Unassigned", no unit.
    expect(data.find((e) => e.title === 'L-40221 · Oakland, CA')).toMatchObject({
      driver: 'Unassigned',
      people: ['Unassigned'],
      truck: '',
    });
  });

  it('derives stop events from board loads only (archived loads have stops but no events)', async () => {
    const archived = await db()
      .select({ n: schema.loads.loadNumber })
      .from(schema.loads)
      .innerJoin(schema.loadStops, eq(schema.loadStops.loadId, schema.loads.id))
      .where(
        and(eq(schema.loads.organizationId, demo), isNotNull(schema.loads.archivedAt), eq(schema.loadStops.appointmentDate, '2026-09-01')),
      );
    expect(archived.length).toBeGreaterThan(0);
    const { data } = await events('from=2026-08-24&to=2026-10-04');
    const stopLoads = new Set(data.filter((e) => e.readOnly).map((e) => e.loadNumber));
    expect([...stopLoads].sort()).toEqual([...BOARD].sort());
    expect(data.filter((e) => e.readOnly)).toHaveLength(16);
  });

  it('filters with q exactly like Runtruck1’s search object (§2.6, §7.4)', async () => {
    const range = 'from=2026-08-24&to=2026-10-04';
    const titles = async (q: string) => (await events(`${range}&q=${encodeURIComponent(q)}`)).data.map((e) => e.title);
    expect(await titles('l-40218')).toEqual(['L-40218 · Fresno, CA', 'L-40218 · Reno, NV']);
    expect(await titles('hale')).toEqual([
      EV[9],
      EV[13],
      'L-40218 · Fresno, CA',
      'L-40218 · Reno, NV',
      'L-40212 · Los Angeles, CA',
      'L-40212 · Las Vegas, NV',
    ]);
    expect(await titles('modesto')).toEqual([EV[1], EV[4], 'L-40210 · Modesto, CA']);
    expect(await titles('unassigned')).toEqual(['L-40221 · Oakland, CA', 'L-40221 · Portland, OR']);
    // Commodity is not searchable; LIKE wildcards are literal.
    expect(await titles('frozen produce')).toEqual([]);
    expect(await titles('96%')).toEqual([EV[10]]);
    expect(await titles('_')).toEqual([]);
    const { meta } = await events(`${range}&q=hale`);
    expect(meta.total).toBe(6);
  });

  it('pages the concatenated list with limit and offset', async () => {
    const { data, meta } = await events(`${WEEK}&limit=5&offset=10`);
    expect(meta).toMatchObject({ total: 27, limit: 5, offset: 10 });
    expect(data.map((e) => e.title)).toEqual([EV[5], EV[6], 'L-40218 · Fresno, CA', 'L-40218 · Reno, NV', 'L-40219 · Stockton, CA']);
  });

  it('refuses malformed ranges with 400, never a 500', async () => {
    const issue = async (qs: string) => {
      const res = await rosa.get(`/api/v1/planner/events?${qs}`).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      return (res.body.error.issues as { path: string; message: string }[]).map((i) => `${i.path}: ${i.message}`);
    };
    expect(await issue('from=0000-01-01&to=0000-01-02')).toContain('from: Use a YYYY-MM-DD date.');
    expect(await issue('from=2026-02-31&to=2026-03-01')).toContain('from: Use a YYYY-MM-DD date.');
    expect(await issue('from=2026-09-06&to=2026-09-01')).toEqual(['to: Must be on or after from.']);
    expect(await issue('from=2026-09-01&to=2026-10-13')).toEqual(['to: A range covers at most 42 days.']);
    expect(await issue('to=2026-09-06')).toEqual([expect.stringMatching(/^from: /)]);
    expect(await issue(`${WEEK}&limit=501`)).toEqual([expect.stringMatching(/^limit: /)]);
  });

  it('needs a session and planner.view', async () => {
    expect((await request(t.server).get(`/api/v1/planner/events?${WEEK}`).expect(401)).body.error.code).toBe('UNAUTHORIZED');
    expect((await driver.get(`/api/v1/planner/events?${WEEK}`).expect(403)).body.error.code).toBe('FORBIDDEN');
    // Accounting holds planner.view and loads.view: the whole calendar.
    expect((await events(WEEK, accounting)).meta.total).toBe(27);
  });

  it('returns office events only without loads.view (§2.3)', async () => {
    const { data, meta } = await events(WEEK, viewOnly);
    expect(meta.total).toBe(12);
    expect(data.every((e) => !e.readOnly)).toBe(true);
  });

  it('never shows another organization’s calendar', async () => {
    const { data, meta } = await events(WEEK, other);
    expect(meta.total).toBe(3);
    expect(data.map((e) => [e.title, e.date, e.start, e.end, e.timezone])).toEqual([
      [OTHER_ORG_FIXTURE.plannerEventTitle, '2026-09-03', '08:00', '08:30', 'America/Chicago'],
      ['L-50001 · Dallas, TX', '2026-09-03', '08:00', '10:00', 'America/Chicago'],
      ['L-50001 · Houston, TX', '2026-09-04', '09:00', '11:00', 'America/Chicago'],
    ]);
    expect(data.find((e) => e.readOnly)).toMatchObject({
      driver: OTHER_ORG_FIXTURE.driverName,
      truck: 'TC-01 / TC-T1',
      customer: OTHER_ORG_FIXTURE.customerName,
    });
  });
});

describe('GET /planner/color-codes (§3.5)', () => {
  it('lists the codes locked first with their office-event counts', async () => {
    const { data, meta } = await get<PlannerColorCodeDto[], PlannerColorCodesMeta>('/planner/color-codes');
    expect(meta).toEqual({ total: 6 });
    expect(data.map((c) => [c.key, c.label, c.tone, c.locked, c.eventCount])).toEqual([
      ['pickup', 'Loaded (pickup)', 'amber', true, 0],
      ['delivery', 'Empty (delivery)', 'green', true, 0],
      ['maintenance', 'Maintenance', 'red', false, 3],
      ['driver', 'Driver schedule', 'purple', false, 5],
      ['meeting', 'Meetings', 'blue', false, 29],
      ['admin', 'Billing & admin', 'teal', false, 5],
    ]);
  });

  it('needs planner.view and stays inside the organization', async () => {
    await request(t.server).get('/api/v1/planner/color-codes').expect(401);
    await driver.get('/api/v1/planner/color-codes').expect(403);
    const mine = new Set((await get<PlannerColorCodeDto[]>('/planner/color-codes')).data.map((c) => c.id));
    const theirs = (await get<PlannerColorCodeDto[]>('/planner/color-codes', other)).data;
    expect(theirs.map((c) => [c.key, c.eventCount])).toEqual([
      ['pickup', 0],
      ['delivery', 0],
      ['maintenance', 0],
      ['driver', 0],
      ['meeting', 1],
      ['admin', 0],
    ]);
    expect(theirs.some((c) => mine.has(c.id))).toBe(false);
  });
});

describe('GET /planner/stop-values (§3.9)', () => {
  it('lists every board-load stop value, sorted, and the L-40218 pickup as the sample', async () => {
    const { data, meta } = await get<PlannerStopValuesDto>('/planner/stop-values');
    expect(meta).toEqual({});
    expect(data.driver).toEqual([
      'Ana Cortez',
      'Dara Whitfield',
      'Ellis Nakamura',
      'Marcus Hale',
      'Priya Raman',
      'Tobias Frey',
      'Unassigned',
    ]);
    expect(data.customer).toEqual([
      'Bayline Distribution',
      'Cascade Building Supply',
      'Harbor Point Retail',
      'Northgate Foods',
      'Sierra Ag Partners',
    ]);
    expect(data.truck).toEqual([
      'T-103 / RF-27',
      'T-107 / DV-51',
      'T-109 / FB-04',
      'T-114 / DV-88',
      'T-114 / RF-88',
      'T-118 / DV-14',
      'T-121 / FB-12',
      'Unassigned',
    ]);
    expect(data.sampleEvent).toMatchObject({
      title: 'L-40218 · Fresno, CA',
      date: '2026-09-03',
      start: '10:30',
      end: '12:30',
      place: 'Fresno, CA',
      colorCodeKey: 'pickup',
      readOnly: true,
    });
  });

  it('is empty without loads.view, with an office event as the sample', async () => {
    const { data } = await get<PlannerStopValuesDto>('/planner/stop-values', viewOnly);
    expect(data).toMatchObject({ driver: [], customer: [], truck: [] });
    expect(data.sampleEvent).toMatchObject({ title: STANDUP, date: '2026-08-24', readOnly: false });
    await driver.get('/api/v1/planner/stop-values').expect(403);
    await request(t.server).get('/api/v1/planner/stop-values').expect(401);
  });

  it('reads only the caller’s organization', async () => {
    const { data } = await get<PlannerStopValuesDto>('/planner/stop-values', other);
    expect(data).toMatchObject({
      driver: [OTHER_ORG_FIXTURE.driverName],
      customer: [OTHER_ORG_FIXTURE.customerName],
      truck: ['TC-01 / TC-T1'],
    });
    expect(data.sampleEvent?.title).toBe('L-50001 · Dallas, TX');
  });
});

describe('GET /planner/related-loads (§3.10)', () => {
  it('lists the board loads in board order with their routes', async () => {
    const { data, meta } = await get<PlannerRelatedLoadDto[], PageMeta>('/planner/related-loads');
    expect(meta).toEqual({ total: 8, limit: 500, offset: 0 });
    expect(data.map((l) => [l.loadNumber, l.route])).toEqual([
      [40218, 'Fresno, CA → Reno, NV'],
      [40219, 'Stockton, CA → Salt Lake City, UT'],
      [40220, 'Sacramento, CA → Boise, ID'],
      [40221, 'Oakland, CA → Portland, OR'],
      [40214, 'Bakersfield, CA → Phoenix, AZ'],
      [40212, 'Los Angeles, CA → Las Vegas, NV'],
      [40210, 'Modesto, CA → Denver, CO'],
      [40222, 'Redding, CA → Seattle, WA'],
    ]);
    expect(Object.keys(data[0]!).sort()).toEqual(['id', 'loadNumber', 'route']);
  });

  it('supports q over the load number and route, and paging', async () => {
    const numbers = async (qs: string) =>
      (await get<PlannerRelatedLoadDto[], PageMeta>(`/planner/related-loads?${qs}`)).data.map((l) => l.loadNumber);
    expect(await numbers('q=reno')).toEqual([40218]);
    expect(await numbers('q=L-4022')).toEqual([40220, 40221, 40222]);
    expect(await numbers('limit=2&offset=1')).toEqual([40219, 40220]);
    const { meta } = await get<PlannerRelatedLoadDto[], PageMeta>('/planner/related-loads?q=ca&limit=1');
    expect(meta.total).toBe(8);
  });

  it('needs planner.manage and loads.view', async () => {
    await request(t.server).get('/api/v1/planner/related-loads').expect(401);
    expect((await accounting.get('/api/v1/planner/related-loads').expect(403)).body.error.code).toBe('FORBIDDEN');
    await manageNoLoads.get('/api/v1/planner/related-loads').expect(403);
    await driver.get('/api/v1/planner/related-loads').expect(403);
  });

  it('lists only the caller’s board loads', async () => {
    const { data } = await get<PlannerRelatedLoadDto[], PageMeta>('/planner/related-loads', other);
    expect(data.map((l) => [l.loadNumber, l.route])).toEqual([[OTHER_ORG_FIXTURE.loadNumber, 'Dallas, TX → Houston, TX']]);
  });
});
