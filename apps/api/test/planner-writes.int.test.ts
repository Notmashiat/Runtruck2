import { hashPassword, schema } from '@runtruck/database';
import { FIXTURE_USERS, OTHER_ORG_FIXTURE } from '@runtruck/database/testing';
import type { Permission } from '@runtruck/permissions';
import type {
  PageMeta,
  PlannerColorCodeDto,
  PlannerEventDto,
  PlannerEventsMeta,
  PlannerRelatedLoadDto,
  PlannerStopValuesDto,
} from '@runtruck/types';
import { and, asc, count, eq, inArray, isNotNull, like, max, min } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, TEST_PASSWORD, type TestContext } from './helpers.js';

// docs/api/planner.md §9 (writes): color codes, Reset calendar, office events, permissions,
// tenant isolation, the audit trail and outbox, and a load created with POST /loads.

type Agent = ReturnType<typeof request.agent>;

let t: TestContext;
let rosa: Agent;
let dispatcher: Agent;
let accounting: Agent;
let driver: Agent;
let other: Agent;
let manageNoLoads: Agent;
let demo: string;
let otherOrg: string;

const db = () => t.db.db;
const MISSING = '00000000-0000-4000-8000-000000000000';

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
  otherOrg = t.orgs.otherOrganizationId;
  rosa = await t.as('admin');
  dispatcher = await t.as('dispatcher');
  accounting = await t.as('accounting');
  driver = await t.as('driver');
  other = await t.as('otherAdmin');
  manageNoLoads = await customMember('planner_manage_w', '100482792', ['planner.view', 'planner.manage']);
});
afterAll(async () => {
  await t.close();
});

// ─── helpers ────────────────────────────────────────────────────────────────────────────

async function codes(agent: Agent = rosa): Promise<PlannerColorCodeDto[]> {
  return (await agent.get('/api/v1/planner/color-codes').expect(200)).body.data as PlannerColorCodeDto[];
}

async function codeId(key: string, agent: Agent = rosa): Promise<string> {
  const code = (await codes(agent)).find((c) => c.key === key);
  if (!code) throw new Error(`no code ${key}`);
  return code.id;
}

async function events(range: string, agent: Agent = rosa): Promise<{ data: PlannerEventDto[]; meta: PlannerEventsMeta }> {
  return (await agent.get(`/api/v1/planner/events?${range}`).expect(200)).body as { data: PlannerEventDto[]; meta: PlannerEventsMeta };
}

async function loadIdOf(org: string, loadNumber: number): Promise<string> {
  const [row] = await db()
    .select({ id: schema.loads.id })
    .from(schema.loads)
    .where(and(eq(schema.loads.organizationId, org), eq(schema.loads.loadNumber, loadNumber)));
  return row!.id;
}

async function userId(email: string): Promise<string> {
  const [row] = await db().select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
  return row!.id;
}

// The planner's audit rows and outbox rows of an organization, oldest first.
async function trail(org: string = demo) {
  const audit = await db()
    .select({
      action: schema.auditLogs.action,
      entityType: schema.auditLogs.entityType,
      entityId: schema.auditLogs.entityId,
      entityLabel: schema.auditLogs.entityLabel,
      previous: schema.auditLogs.previous,
      next: schema.auditLogs.next,
      actorUserId: schema.auditLogs.actorUserId,
      organizationId: schema.auditLogs.organizationId,
    })
    .from(schema.auditLogs)
    .where(and(eq(schema.auditLogs.organizationId, org), like(schema.auditLogs.action, 'PLANNER_%')))
    .orderBy(asc(schema.auditLogs.occurredAt), asc(schema.auditLogs.id));
  const outbox = await db()
    .select({
      type: schema.events.type,
      aggregateType: schema.events.aggregateType,
      aggregateId: schema.events.aggregateId,
      payload: schema.events.payload,
      organizationId: schema.events.organizationId,
      actorUserId: schema.events.actorUserId,
    })
    .from(schema.events)
    .where(and(eq(schema.events.organizationId, org), like(schema.events.type, 'Planner%')))
    .orderBy(asc(schema.events.occurredAt), asc(schema.events.id));
  return { audit, outbox };
}

// Runs a write and returns the audit and outbox rows it added (of the demo organization,
// unless another is given).
async function newTrail<T>(write: () => Promise<T>, org: string = demo) {
  const before = await trail(org);
  const result = await write();
  const after = await trail(org);
  return { result, audit: after.audit.slice(before.audit.length), outbox: after.outbox.slice(before.outbox.length) };
}

async function plannerCounts(org: string) {
  const [e] = await db().select({ n: count() }).from(schema.plannerEvents).where(eq(schema.plannerEvents.organizationId, org));
  const [c] = await db().select({ n: count() }).from(schema.plannerColorCodes).where(eq(schema.plannerColorCodes.organizationId, org));
  return { events: e!.n, codes: c!.n };
}

const issuesOf = (res: request.Response) =>
  (res.body.error.issues as { path: string; message: string }[]).map((i) => `${i.path}: ${i.message}`);

// ─── color codes ────────────────────────────────────────────────────────────────────────

describe('color codes (§3.6–§3.8)', () => {
  let added: PlannerColorCodeDto;

  it('adds "New color code" with the first unused tone, audited and emitted', async () => {
    const rosaId = await userId(FIXTURE_USERS.admin);
    const { result, audit, outbox } = await newTrail(() => rosa.post('/api/v1/planner/color-codes').send({}).expect(201));
    added = result.body.data;
    expect(result.body.meta).toEqual({});
    expect(added).toEqual({
      id: expect.any(String),
      key: `code-${added.id}`,
      label: 'New color code',
      tone: 'pink',
      locked: false,
      eventCount: 0,
    });
    const [row] = await db()
      .select({ position: schema.plannerColorCodes.position })
      .from(schema.plannerColorCodes)
      .where(eq(schema.plannerColorCodes.id, added.id));
    expect(row!.position).toBe(7);
    expect(audit).toEqual([
      {
        action: 'PLANNER_COLOR_CODE_CREATED',
        entityType: 'planner_color_code',
        entityId: added.id,
        entityLabel: 'New color code',
        previous: null,
        next: { key: added.key, label: 'New color code', tone: 'pink' },
        actorUserId: rosaId,
        organizationId: demo,
      },
    ]);
    expect(outbox).toEqual([
      {
        type: 'PlannerColorCodeCreated',
        aggregateType: 'planner_color_code',
        aggregateId: added.id,
        payload: { colorCodeId: added.id },
        organizationId: demo,
        actorUserId: rosaId,
      },
    ]);
    const second = (await rosa.post('/api/v1/planner/color-codes').send({}).expect(201)).body.data as PlannerColorCodeDto;
    expect(second.tone).toBe('orange');
    const named = (await rosa.post('/api/v1/planner/color-codes').send({ label: 'Yard', tone: 'teal' }).expect(201)).body
      .data as PlannerColorCodeDto;
    expect(named).toMatchObject({ label: 'Yard', tone: 'teal' });
  });

  it('renames and recolours; a blank label becomes "Untitled"; a no-op writes nothing', async () => {
    const renamed = await newTrail(() => rosa.patch(`/api/v1/planner/color-codes/${added.id}`).send({ label: '   ' }).expect(200));
    expect(renamed.result.body.data).toMatchObject({ id: added.id, label: 'Untitled', tone: 'pink', key: added.key, locked: false });
    expect(renamed.audit).toMatchObject([
      { action: 'PLANNER_COLOR_CODE_UPDATED', entityLabel: 'Untitled', previous: { label: 'New color code' }, next: { label: 'Untitled' } },
    ]);
    expect(renamed.outbox).toMatchObject([
      { type: 'PlannerColorCodeUpdated', payload: { colorCodeId: added.id, changedFields: ['label'] } },
    ]);

    // Labels are stored as typed (not trimmed).
    const typed = await rosa.patch(`/api/v1/planner/color-codes/${added.id}`).send({ label: ' Yard moves ', tone: 'indigo' }).expect(200);
    expect(typed.body.data).toMatchObject({ label: ' Yard moves ', tone: 'indigo' });

    const noop = await newTrail(() => rosa.patch(`/api/v1/planner/color-codes/${added.id}`).send({ label: ' Yard moves ' }).expect(200));
    expect(noop.result.body.data.label).toBe(' Yard moves ');
    expect(noop.audit).toEqual([]);
    expect(noop.outbox).toEqual([]);
  });

  it('lets locked codes be renamed and recoloured (B16), never re-keyed or unlocked', async () => {
    const pickup = await codeId('pickup');
    const res = await rosa.patch(`/api/v1/planner/color-codes/${pickup}`).send({ label: 'Loaded', tone: 'slate' }).expect(200);
    expect(res.body.data).toMatchObject({ key: 'pickup', label: 'Loaded', tone: 'slate', locked: true });
    await rosa.patch(`/api/v1/planner/color-codes/${pickup}`).send({ label: 'Loaded (pickup)', tone: 'amber' }).expect(200);
    await rosa.patch(`/api/v1/planner/color-codes/${pickup}`).send({ key: 'x' }).expect(400);
    await rosa.patch(`/api/v1/planner/color-codes/${pickup}`).send({ locked: false }).expect(400);
  });

  it('validates bodies and ids', async () => {
    expect(issuesOf(await rosa.patch(`/api/v1/planner/color-codes/${added.id}`).send({}).expect(400))).toEqual([
      ': Change at least one field.',
    ]);
    expect((await rosa.post('/api/v1/planner/color-codes').send({ tone: 'magenta' }).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    expect(
      issuesOf(
        await rosa
          .post('/api/v1/planner/color-codes')
          .send({ label: 'x'.repeat(81) })
          .expect(400),
      ),
    ).toEqual(['label: Use at most 80 characters.']);
    expect(issuesOf(await rosa.post('/api/v1/planner/color-codes').send({ organizationId: otherOrg }).expect(400))[0]).toMatch(
      /organizationId/,
    );
    await rosa.patch('/api/v1/planner/color-codes/not-a-uuid').send({ label: 'x' }).expect(400);
    await rosa.delete('/api/v1/planner/color-codes/not-a-uuid').expect(400);
    const missing = await rosa.patch(`/api/v1/planner/color-codes/${MISSING}`).send({ label: 'x' }).expect(404);
    expect(missing.body.error).toMatchObject({ code: 'PLANNER_COLOR_CODE_NOT_FOUND', message: 'Color code was not found.' });
    expect((await rosa.delete(`/api/v1/planner/color-codes/${MISSING}`).expect(404)).body.error.code).toBe('PLANNER_COLOR_CODE_NOT_FOUND');
  });

  it('needs planner.configure and a session', async () => {
    const before = await trail();
    await request(t.server).post('/api/v1/planner/color-codes').send({}).expect(401);
    await request(t.server).patch(`/api/v1/planner/color-codes/${added.id}`).send({ label: 'x' }).expect(401);
    await request(t.server).delete(`/api/v1/planner/color-codes/${added.id}`).expect(401);
    expect((await dispatcher.post('/api/v1/planner/color-codes').send({}).expect(403)).body.error.code).toBe('FORBIDDEN');
    await dispatcher.patch(`/api/v1/planner/color-codes/${added.id}`).send({ label: 'x' }).expect(403);
    await dispatcher.delete(`/api/v1/planner/color-codes/${added.id}`).expect(403);
    await accounting.post('/api/v1/planner/color-codes').send({}).expect(403);
    await driver.post('/api/v1/planner/color-codes').send({}).expect(403);
    expect(await trail()).toEqual(before);
  });

  it('never touches another organization’s codes', async () => {
    const theirMeeting = await codeId('meeting', other);
    await rosa.patch(`/api/v1/planner/color-codes/${theirMeeting}`).send({ label: 'x' }).expect(404);
    await rosa.delete(`/api/v1/planner/color-codes/${theirMeeting}`).expect(404);
    await other.patch(`/api/v1/planner/color-codes/${added.id}`).send({ label: 'x' }).expect(404);
    await other.delete(`/api/v1/planner/color-codes/${added.id}`).expect(404);
    expect((await codes()).find((c) => c.id === added.id)?.label).toBe(' Yard moves ');
  });

  it('deletes Meetings by moving its 29 events to Maintenance', async () => {
    const [meeting, maintenance] = [await codeId('meeting'), await codeId('maintenance')];
    const { result, audit, outbox } = await newTrail(() => rosa.delete(`/api/v1/planner/color-codes/${meeting}`).expect(200));
    expect(result.body).toEqual({ data: { id: meeting, reassignedToColorCodeId: maintenance, reassignedEventCount: 29 }, meta: {} });
    expect(audit).toMatchObject([
      {
        action: 'PLANNER_COLOR_CODE_DELETED',
        entityId: meeting,
        entityLabel: 'Meetings',
        previous: { key: 'meeting', label: 'Meetings', tone: 'blue' },
        next: { reassignedToColorCodeId: maintenance, reassignedEventCount: 29 },
      },
    ]);
    expect(outbox).toMatchObject([
      {
        type: 'PlannerColorCodeDeleted',
        payload: { colorCodeId: meeting, reassignedToColorCodeId: maintenance, reassignedEventCount: 29 },
      },
    ]);
    const after = await codes();
    expect(after.find((c) => c.key === 'maintenance')?.eventCount).toBe(32);
    expect(after.some((c) => c.key === 'meeting')).toBe(false);
  });

  it('refuses to delete a locked code or the last unlocked code', async () => {
    const locked = await rosa.delete(`/api/v1/planner/color-codes/${await codeId('pickup')}`).expect(409);
    expect(locked.body.error).toMatchObject({ code: 'PLANNER_COLOR_CODE_LOCKED', message: "Load-board color codes can't be deleted." });
    // Driver schedule → Maintenance (5 events), then everything else but Maintenance.
    const driverDelete = await rosa.delete(`/api/v1/planner/color-codes/${await codeId('driver')}`).expect(200);
    expect(driverDelete.body.data).toMatchObject({ reassignedToColorCodeId: await codeId('maintenance'), reassignedEventCount: 5 });
    for (const c of await codes()) {
      if (!c.locked && c.key !== 'maintenance') await rosa.delete(`/api/v1/planner/color-codes/${c.id}`).expect(200);
    }
    const last = await rosa.delete(`/api/v1/planner/color-codes/${await codeId('maintenance')}`).expect(409);
    expect(last.body.error).toMatchObject({
      code: 'PLANNER_LAST_COLOR_CODE',
      message: 'Keep at least one color code for your own events.',
    });
    expect((await codes()).map((c) => [c.key, c.eventCount])).toEqual([
      ['pickup', 0],
      ['delivery', 0],
      ['maintenance', 42],
    ]);
  });

  it('caps an organization at 100 color codes', async () => {
    const { codes: n } = await plannerCounts(demo);
    await db()
      .insert(schema.plannerColorCodes)
      .values(
        Array.from({ length: 100 - n }, (_, i) => ({
          organizationId: demo,
          key: `bulk-${i}`,
          label: `Bulk ${i}`,
          tone: 'slate' as const,
          position: 100 + i,
        })),
      );
    const res = await rosa.post('/api/v1/planner/color-codes').send({}).expect(409);
    expect(res.body.error).toMatchObject({
      code: 'PLANNER_COLOR_CODE_LIMIT',
      message: 'An organization can have at most 100 color codes.',
    });
  });
});

// ─── reset ──────────────────────────────────────────────────────────────────────────────

describe('POST /planner/reset (§3.11)', () => {
  it('is refused without planner.reset and changes nothing', async () => {
    const before = { counts: await plannerCounts(demo), trail: await trail() };
    expect((await dispatcher.post('/api/v1/planner/reset').send({}).expect(403)).body.error.code).toBe('FORBIDDEN');
    await accounting.post('/api/v1/planner/reset').send({}).expect(403);
    await request(t.server).post('/api/v1/planner/reset').send({}).expect(401);
    expect(issuesOf(await rosa.post('/api/v1/planner/reset').send({ everything: true }).expect(400))[0]).toMatch(/everything/);
    expect({ counts: await plannerCounts(demo), trail: await trail() }).toEqual(before);
  });

  it('restores Sunridge’s own defaults: 42 events and 6 codes with new ids and the seeded order', async () => {
    const oldIds = new Set((await codes()).map((c) => c.id));
    const before = await plannerCounts(demo);
    const theirsBefore = await codes(other);
    const { result, audit, outbox } = await newTrail(() => rosa.post('/api/v1/planner/reset').send({}).expect(200));
    expect(result.body).toEqual({ data: { eventCount: 42, colorCodeCount: 6 }, meta: {} });

    const after = await codes();
    expect(after.map((c) => [c.key, c.label, c.tone, c.locked, c.eventCount])).toEqual([
      ['pickup', 'Loaded (pickup)', 'amber', true, 0],
      ['delivery', 'Empty (delivery)', 'green', true, 0],
      ['maintenance', 'Maintenance', 'red', false, 3],
      ['driver', 'Driver schedule', 'purple', false, 5],
      ['meeting', 'Meetings', 'blue', false, 29],
      ['admin', 'Billing & admin', 'teal', false, 5],
    ]);
    expect(after.some((c) => oldIds.has(c.id))).toBe(false);

    const [instants] = await db()
      .select({ first: min(schema.plannerEvents.createdAt), last: max(schema.plannerEvents.createdAt) })
      .from(schema.plannerEvents)
      .where(eq(schema.plannerEvents.organizationId, demo));
    expect(instants!.first?.toISOString()).toBe('2026-09-02T23:59:18.000Z');
    expect(instants!.last?.toISOString()).toBe('2026-09-02T23:59:59.000Z');
    const week = await events('from=2026-08-31&to=2026-09-06');
    expect(week.meta.total).toBe(27);
    expect(week.data.slice(0, 6).map((e) => e.title)).toEqual([
      'Dispatch standup',
      'Dispatch standup',
      'Dispatch standup',
      'Dispatch standup',
      'Dispatch standup',
      'Tobias Frey — home time',
    ]);

    expect(audit).toMatchObject([
      {
        action: 'PLANNER_RESET',
        entityType: 'organization',
        entityId: demo,
        entityLabel: 'Sunridge Freight',
        previous: { eventCount: before.events, colorCodeCount: before.codes },
        next: { eventCount: 42, colorCodeCount: 6 },
      },
    ]);
    expect(outbox).toMatchObject([
      { type: 'PlannerReset', aggregateType: 'organization', aggregateId: demo, payload: { eventCount: 42, colorCodeCount: 6 } },
    ]);
    // The other tenant's calendar is untouched.
    expect(await codes(other)).toEqual(theirsBefore);
  });

  it('restores only the standard codes for another organization and leaves Sunridge unchanged', async () => {
    const sunridge = { codes: await codes(), counts: await plannerCounts(demo) };
    const { result, audit, outbox } = await newTrail(() => other.post('/api/v1/planner/reset').send({}).expect(200), otherOrg);
    expect(result.body.data).toEqual({ eventCount: 0, colorCodeCount: 6 });
    expect(audit).toMatchObject([
      {
        action: 'PLANNER_RESET',
        entityId: otherOrg,
        entityLabel: 'Test Carrier Co',
        next: { eventCount: 0, colorCodeCount: 6 },
        organizationId: otherOrg,
      },
    ]);
    expect(outbox).toMatchObject([{ type: 'PlannerReset', aggregateId: otherOrg, organizationId: otherOrg }]);
    expect(await plannerCounts(otherOrg)).toEqual({ events: 0, codes: 6 });
    // No Sunridge staff, customer or invoice was written into the other tenant.
    const theirs = await db()
      .select({ label: schema.plannerColorCodes.label })
      .from(schema.plannerColorCodes)
      .where(eq(schema.plannerColorCodes.organizationId, otherOrg));
    expect(JSON.stringify(theirs)).not.toMatch(/Rosa Medina|Northgate|INV-8836/);
    expect(await codes()).toEqual(sunridge.codes);
    expect(await plannerCounts(demo)).toEqual(sunridge.counts);
  });
});

// ─── office events ──────────────────────────────────────────────────────────────────────

describe('office events (§3.2–§3.4)', () => {
  let created: PlannerEventDto;

  it('creates a timed event with Runtruck1’s normalization, audited and emitted', async () => {
    const [meeting, l40218] = [await codeId('meeting'), await loadIdOf(demo, 40218)];
    const rosaId = await userId(FIXTURE_USERS.admin);
    const body = {
      title: '  Yard walk ',
      colorCodeId: meeting,
      date: '2026-09-03',
      start: '15:00',
      end: '16:00',
      place: '  Modesto, CA ',
      notes: '  keep my spaces ',
      people: [' Rosa Medina ', '', '  '],
      loadId: l40218,
    };
    const { result, audit, outbox } = await newTrail(() => rosa.post('/api/v1/planner/events').send(body).expect(201));
    created = result.body.data;
    expect(result.body.meta).toEqual({});
    expect(created).toEqual({
      id: expect.any(String),
      readOnly: false,
      title: 'Yard walk',
      colorCodeId: meeting,
      colorCodeKey: 'meeting',
      date: '2026-09-03',
      endDate: null,
      start: '15:00',
      end: '16:00',
      timezone: 'America/Los_Angeles',
      place: 'Modesto, CA',
      notes: '  keep my spaces ',
      people: ['Rosa Medina'],
      loadId: l40218,
      loadNumber: 40218,
      facility: null,
      customer: null,
      driver: null,
      truck: null,
      commodity: null,
    });
    const fields = {
      title: 'Yard walk',
      colorCodeId: meeting,
      date: '2026-09-03',
      endDate: null,
      start: '15:00',
      end: '16:00',
      place: 'Modesto, CA',
      notes: '  keep my spaces ',
      people: ['Rosa Medina'],
      loadId: l40218,
    };
    expect(audit).toEqual([
      {
        action: 'PLANNER_EVENT_CREATED',
        entityType: 'planner_event',
        entityId: created.id,
        entityLabel: 'Yard walk',
        previous: null,
        next: fields,
        actorUserId: rosaId,
        organizationId: demo,
      },
    ]);
    expect(outbox).toEqual([
      {
        type: 'PlannerEventCreated',
        aggregateType: 'planner_event',
        aggregateId: created.id,
        payload: { plannerEventId: created.id, colorCodeId: meeting, startsOn: '2026-09-03' },
        organizationId: demo,
        actorUserId: rosaId,
      },
    ]);
    const [row] = await db()
      .select({ by: schema.plannerEvents.createdByUserId })
      .from(schema.plannerEvents)
      .where(eq(schema.plannerEvents.id, created.id));
    expect(row!.by).toBe(rosaId);
  });

  it('lists a new event after the seeded ones of its day (§2.5)', async () => {
    const day = await events('from=2026-09-03&to=2026-09-03');
    expect(day.data.map((e) => e.title)).toEqual([
      'Dispatch standup',
      'Tobias Frey — home time',
      'T-118 in shop — turbo',
      'FB-12 DOT annual inspection',
      'Yard walk',
      'L-40218 · Fresno, CA',
      'L-40219 · Stockton, CA',
    ]);
  });

  it('creates all-day events; an end date equal to the start is dropped', async () => {
    const admin = await codeId('admin');
    const single = await rosa
      .post('/api/v1/planner/events')
      .send({ title: 'Office closed', colorCodeId: admin, date: '2026-09-14', endDate: '2026-09-14' })
      .expect(201);
    expect(single.body.data).toMatchObject({
      date: '2026-09-14',
      endDate: null,
      start: null,
      end: null,
      place: null,
      notes: null,
      people: [],
      loadId: null,
    });
    const span = await rosa
      .post('/api/v1/planner/events')
      .send({ title: 'Audit week', colorCodeId: admin, date: '2026-09-14', endDate: '2026-09-18', notes: '' })
      .expect(201);
    expect(span.body.data).toMatchObject({ endDate: '2026-09-18', notes: null });
    // A multi-day event that started before the range is returned so its chips draw.
    const range = await events('from=2026-09-16&to=2026-09-16');
    expect(range.data.map((e) => e.title)).toContain('Audit week');

    // The longest event (366 days) is still found from its last day: the `from − 366` bound
    // of §3.1 is exact.
    await rosa
      .post('/api/v1/planner/events')
      .send({ title: 'Year-long audit', colorCodeId: admin, date: '2025-09-01', endDate: '2026-09-02' })
      .expect(201);
    expect((await events('from=2026-09-02&to=2026-09-02')).data.map((e) => e.title)).toContain('Year-long audit');
    expect((await events('from=2026-09-03&to=2026-09-03')).data.map((e) => e.title)).not.toContain('Year-long audit');
  });

  it('refuses invalid events with the §2.7 issues and writes nothing', async () => {
    const [meeting, pickup] = [await codeId('meeting'), await codeId('pickup')];
    const [archived] = await db()
      .select({ id: schema.loads.id })
      .from(schema.loads)
      .where(and(eq(schema.loads.organizationId, demo), isNotNull(schema.loads.archivedAt)))
      .limit(1);
    const base = { title: 'X', colorCodeId: meeting, date: '2026-09-10' };
    const before = await trail();
    const refuse = async (body: object) => issuesOf(await rosa.post('/api/v1/planner/events').send(body).expect(400));
    expect(await refuse({ ...base, title: '   ' })).toEqual(['title: Enter a title.']);
    expect(await refuse({ ...base, start: '10:00', end: '10:00' })).toEqual(['end: Must be after the start']);
    expect(await refuse({ ...base, start: '10:00' })).toEqual(['end: Enter a start and an end time, or make the event all day.']);
    expect(await refuse({ ...base, start: '9:00', end: '10:00' })).toContain('start: Use a HH:MM time.');
    expect(await refuse({ ...base, endDate: '2026-09-09' })).toEqual(['endDate: Must be on or after the start date']);
    expect(await refuse({ ...base, endDate: '2027-09-12' })).toEqual(['endDate: An event spans at most a year.']);
    expect(await refuse({ ...base, endDate: '2026-09-12', start: '10:00', end: '11:00' })).toEqual([
      'endDate: Only all-day events can span several days.',
    ]);
    expect(await refuse({ ...base, date: '2026-02-31' })).toEqual(['date: Use a YYYY-MM-DD date.']);
    expect(await refuse({ ...base, colorCodeId: pickup })).toEqual([
      "colorCodeId: Load-board color codes can't be used for your own events.",
    ]);
    expect(await refuse({ ...base, colorCodeId: MISSING })).toEqual(['colorCodeId: Choose one of your color codes.']);
    expect(await refuse({ ...base, colorCodeId: 'nope' })).toEqual(['colorCodeId: Choose one of your color codes.']);
    expect(await refuse({ ...base, loadId: archived!.id })).toEqual(['loadId: Choose a load from the board.']);
    expect(await refuse({ ...base, loadId: MISSING })).toEqual(['loadId: Choose a load from the board.']);
    expect((await refuse({ ...base, readOnly: true }))[0]).toMatch(/readOnly/);
    expect((await refuse({ ...base, organizationId: otherOrg }))[0]).toMatch(/organizationId/);
    expect(await trail()).toEqual(before);
  });

  it('updates the changed fields only, audited with previous and next', async () => {
    const { result, audit, outbox } = await newTrail(() =>
      rosa.patch(`/api/v1/planner/events/${created.id}`).send({ title: 'Yard walk-through', place: '' }).expect(200),
    );
    expect(result.body.data).toMatchObject({ id: created.id, title: 'Yard walk-through', place: null, loadNumber: 40218, start: '15:00' });
    expect(audit).toMatchObject([
      {
        action: 'PLANNER_EVENT_UPDATED',
        entityId: created.id,
        entityLabel: 'Yard walk-through',
        previous: { title: 'Yard walk', place: 'Modesto, CA' },
        next: { title: 'Yard walk-through', place: null },
      },
    ]);
    expect(outbox).toMatchObject([
      { type: 'PlannerEventUpdated', payload: { plannerEventId: created.id, changedFields: ['title', 'place'] } },
    ]);

    // A no-op save writes nothing.
    const noop = await newTrail(() =>
      rosa
        .patch(`/api/v1/planner/events/${created.id}`)
        .send({ title: ' Yard walk-through ', people: ['Rosa Medina'] })
        .expect(200),
    );
    expect(noop.audit).toEqual([]);
    expect(noop.outbox).toEqual([]);

    // Timed → all-day, then back to timed.
    const allDay = await rosa.patch(`/api/v1/planner/events/${created.id}`).send({ start: null, end: null }).expect(200);
    expect(allDay.body.data).toMatchObject({ start: null, end: null, endDate: null });
    const timed = await rosa
      .patch(`/api/v1/planner/events/${created.id}`)
      .send({ start: '07:00', end: '07:30', endDate: null })
      .expect(200);
    expect(timed.body.data).toMatchObject({ start: '07:00', end: '07:30' });
    // The pairwise rules hold on the merged event.
    expect(issuesOf(await rosa.patch(`/api/v1/planner/events/${created.id}`).send({ endDate: '2026-09-05' }).expect(400))).toEqual([
      'endDate: Only all-day events can span several days.',
    ]);
    expect(issuesOf(await rosa.patch(`/api/v1/planner/events/${created.id}`).send({ end: '06:00' }).expect(400))).toEqual([
      'end: Must be after the start',
    ]);
    // (Ids are resolved before a request is built: supertest shares one ephemeral server.)
    const delivery = await codeId('delivery');
    expect(issuesOf(await rosa.patch(`/api/v1/planner/events/${created.id}`).send({ colorCodeId: delivery }).expect(400))).toEqual([
      "colorCodeId: Load-board color codes can't be used for your own events.",
    ]);
    expect(issuesOf(await rosa.patch(`/api/v1/planner/events/${created.id}`).send({}).expect(400))).toEqual([
      ': Change at least one field.',
    ]);
  });

  it('keeps an unchanged link to a since-archived load (§3.3 step 3)', async () => {
    const l40222 = await loadIdOf(demo, 40222);
    const admin = await codeId('admin');
    const linked = (
      await rosa
        .post('/api/v1/planner/events')
        .send({ title: 'Mill check', colorCodeId: admin, date: '2026-09-05', loadId: l40222 })
        .expect(201)
    ).body.data as PlannerEventDto;
    await db()
      .update(schema.loads)
      .set({ archivedAt: new Date('2026-09-03T12:00:00Z') })
      .where(eq(schema.loads.id, l40222));
    try {
      const edited = await rosa.patch(`/api/v1/planner/events/${linked.id}`).send({ title: 'Mill check-in', loadId: l40222 }).expect(200);
      expect(edited.body.data).toMatchObject({ title: 'Mill check-in', loadId: l40222, loadNumber: 40222 });
      // Linking another event to it now is refused.
      expect(issuesOf(await rosa.patch(`/api/v1/planner/events/${created.id}`).send({ loadId: l40222 }).expect(400))).toEqual([
        'loadId: Choose a load from the board.',
      ]);
    } finally {
      await db().update(schema.loads).set({ archivedAt: null }).where(eq(schema.loads.id, l40222));
    }
  });

  it('answers 404 for unknown, foreign and load-stop ids, and 400 for malformed ones', async () => {
    const [stop] = await db()
      .select({ id: schema.loadStops.id })
      .from(schema.loadStops)
      .where(and(eq(schema.loadStops.organizationId, demo), eq(schema.loadStops.kind, 'pickup')))
      .limit(1);
    for (const id of [MISSING, stop!.id]) {
      const patch = await rosa.patch(`/api/v1/planner/events/${id}`).send({ title: 'x' }).expect(404);
      expect(patch.body.error).toMatchObject({ code: 'PLANNER_EVENT_NOT_FOUND', message: 'Event was not found.' });
      await rosa.delete(`/api/v1/planner/events/${id}`).expect(404);
    }
    await rosa.patch('/api/v1/planner/events/not-a-uuid').send({ title: 'x' }).expect(400);
    expect((await rosa.delete('/api/v1/planner/events/not-a-uuid').expect(400)).body.error.code).toBe('VALIDATION_ERROR');
  });

  it('enforces planner.manage, and loads.view for related loads (§2.3)', async () => {
    const meeting = await codeId('meeting');
    const l40218 = await loadIdOf(demo, 40218);
    const before = await trail();
    await request(t.server).post('/api/v1/planner/events').send({ title: 'x', colorCodeId: meeting, date: '2026-09-10' }).expect(401);
    await request(t.server).patch(`/api/v1/planner/events/${created.id}`).send({ title: 'x' }).expect(401);
    await request(t.server).delete(`/api/v1/planner/events/${created.id}`).expect(401);
    expect(
      (await accounting.post('/api/v1/planner/events').send({ title: 'x', colorCodeId: meeting, date: '2026-09-10' }).expect(403)).body
        .error.code,
    ).toBe('FORBIDDEN');
    await accounting.patch(`/api/v1/planner/events/${created.id}`).send({ title: 'x' }).expect(403);
    await accounting.delete(`/api/v1/planner/events/${created.id}`).expect(403);
    await driver.post('/api/v1/planner/events').send({ title: 'x', colorCodeId: meeting, date: '2026-09-10' }).expect(403);
    await manageNoLoads
      .post('/api/v1/planner/events')
      .send({ title: 'x', colorCodeId: meeting, date: '2026-09-10', loadId: l40218 })
      .expect(403);
    expect(await trail()).toEqual(before);

    const mine = await manageNoLoads
      .post('/api/v1/planner/events')
      .send({ title: 'No load', colorCodeId: meeting, date: '2026-09-10' })
      .expect(201);
    await manageNoLoads.patch(`/api/v1/planner/events/${mine.body.data.id}`).send({ loadId: l40218 }).expect(403);
    // Only a non-null related load is checked (§3.3 step 3): an unchanged link is kept on a
    // full-body save, and clearing a link exposes no load data.
    const linked = (
      await rosa
        .post('/api/v1/planner/events')
        .send({ title: 'Linked', colorCodeId: meeting, date: '2026-09-11', loadId: l40218 })
        .expect(201)
    ).body.data as PlannerEventDto;
    await manageNoLoads.patch(`/api/v1/planner/events/${linked.id}`).send({ title: 'Linked call', loadId: l40218 }).expect(200);
    const cleared = await manageNoLoads.patch(`/api/v1/planner/events/${linked.id}`).send({ loadId: null }).expect(200);
    expect(cleared.body.data).toMatchObject({ title: 'Linked call', loadId: null, loadNumber: null });
    // An office event's related load number is shown to every planner.view member (P3).
    const seen = (await events('from=2026-09-03&to=2026-09-03', manageNoLoads)).data.find((e) => e.id === created.id);
    expect(seen).toMatchObject({ loadNumber: 40218 });
    const dispatched = await dispatcher
      .post('/api/v1/planner/events')
      .send({ title: 'Dispatch sync', colorCodeId: meeting, date: '2026-09-10', loadId: l40218 })
      .expect(201);
    expect(dispatched.body.data.loadNumber).toBe(40218);
  });

  it('isolates tenants on every event write', async () => {
    const theirMeeting = await codeId('meeting', other);
    const theirEvent = (
      await other
        .post('/api/v1/planner/events')
        .send({ title: 'Test Carrier sync', colorCodeId: theirMeeting, date: '2026-09-10' })
        .expect(201)
    ).body.data as PlannerEventDto;
    expect(theirEvent.timezone).toBe(OTHER_ORG_FIXTURE.timezone);
    await other.patch(`/api/v1/planner/events/${created.id}`).send({ title: 'x' }).expect(404);
    await other.delete(`/api/v1/planner/events/${created.id}`).expect(404);
    await rosa.patch(`/api/v1/planner/events/${theirEvent.id}`).send({ title: 'x' }).expect(404);
    await rosa.delete(`/api/v1/planner/events/${theirEvent.id}`).expect(404);
    const [sunridgeMeeting, l40218] = [await codeId('meeting'), await loadIdOf(demo, 40218)];
    expect(
      issuesOf(
        await other.post('/api/v1/planner/events').send({ title: 'x', colorCodeId: sunridgeMeeting, date: '2026-09-10' }).expect(400),
      ),
    ).toEqual(['colorCodeId: Choose one of your color codes.']);
    expect(
      issuesOf(
        await other
          .post('/api/v1/planner/events')
          .send({ title: 'x', colorCodeId: theirMeeting, date: '2026-09-10', loadId: l40218 })
          .expect(400),
      ),
    ).toEqual(['loadId: Choose a load from the board.']);
    expect(
      issuesOf(await rosa.post('/api/v1/planner/events').send({ title: 'x', colorCodeId: theirMeeting, date: '2026-09-10' }).expect(400)),
    ).toEqual(['colorCodeId: Choose one of your color codes.']);
    const mine = (await events('from=2026-09-10&to=2026-09-10')).data.map((e) => e.title);
    expect(mine).not.toContain('Test Carrier sync');
  });

  it('deletes an event without confirmation, audited and emitted (B7)', async () => {
    const { result, audit, outbox } = await newTrail(() => rosa.delete(`/api/v1/planner/events/${created.id}`).expect(200));
    expect(result.body).toEqual({ data: { id: created.id }, meta: {} });
    expect(audit).toMatchObject([
      {
        action: 'PLANNER_EVENT_DELETED',
        entityId: created.id,
        entityLabel: 'Yard walk-through',
        previous: { title: 'Yard walk-through', start: '07:00' },
        next: null,
      },
    ]);
    expect(outbox).toMatchObject([{ type: 'PlannerEventDeleted', payload: { plannerEventId: created.id } }]);
    await rosa.delete(`/api/v1/planner/events/${created.id}`).expect(404);
  });
});

// ─── a load created with POST /loads (§9 item 4) ───────────────────────────────────────

describe('a load created with New Load', () => {
  it('appears first in related loads, as stop events with the window / 08:00–09:00 rule, and as the sample', async () => {
    const [customer] = await db()
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(and(eq(schema.customers.organizationId, demo), eq(schema.customers.name, 'Bayline Distribution')));
    const [carrier] = await db()
      .select({ id: schema.carriers.id })
      .from(schema.carriers)
      .where(and(eq(schema.carriers.organizationId, demo), eq(schema.carriers.name, 'Valley Line Transport')));
    const body = {
      customerId: customer!.id,
      billToCustomerId: null,
      tenderRef: 'PO 55-90200',
      mode: 'ltl',
      equipmentType: 'dry_van_53',
      dispatcherName: 'Rosa Medina',
      stops: [
        {
          kind: 'pickup',
          facilityName: 'Bayline DC 4',
          addressLine1: '2900 Navy Dr',
          city: 'Stockton',
          state: 'CA',
          postalCode: '',
          appointmentDate: '2026-09-04',
          windowOpen: '09:00',
          windowClose: '11:00',
        },
        {
          kind: 'delivery',
          facilityName: 'Wasatch Crossdock',
          addressLine1: '1740 S 4130 W',
          city: 'Salt Lake City',
          state: 'UT',
          postalCode: '84104',
          appointmentDate: '2026-09-06',
          windowOpen: null,
          windowClose: '14:00',
        },
      ],
      commodity: 'Palletized dry goods',
      weightLb: 6200,
      packaging: 'pallets',
      hazmat: false,
      ltl: {
        freightClass: '70',
        nmfc: null,
        handlingUnits: 4,
        lengthIn: null,
        widthIn: null,
        heightIn: null,
        stackable: false,
        services: ['liftgate_delivery'],
      },
      haul: {
        hauledBy: 'partner_carrier',
        carrierId: carrier!.id,
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
    const load = (await rosa.post('/api/v1/loads').send(body).expect(201)).body.data as { id: string; loadNumber: number };

    const related = (await rosa.get('/api/v1/planner/related-loads').expect(200)).body as { data: PlannerRelatedLoadDto[]; meta: PageMeta };
    expect(related.meta.total).toBe(9);
    expect(related.data[0]).toEqual({ id: load.id, loadNumber: load.loadNumber, route: 'Stockton, CA → Salt Lake City, UT' });

    const week = await events('from=2026-08-31&to=2026-09-06');
    const mine = week.data.filter((e) => e.loadId === load.id);
    expect(mine.map((e) => [e.title, e.date, e.start, e.end, e.place, e.notes, e.driver, e.truck])).toEqual([
      // Both window ends set: the window.
      [
        `L-${load.loadNumber} · Stockton, CA`,
        '2026-09-04',
        '09:00',
        '11:00',
        'Stockton, CA',
        'Bayline DC 4 · Bayline Distribution',
        'Unassigned',
        '',
      ],
      // Only a close time (Runtruck1 B4): 08:00–09:00.
      [
        `L-${load.loadNumber} · Salt Lake City, UT`,
        '2026-09-06',
        '08:00',
        '09:00',
        'Salt Lake City, UT',
        'Wasatch Crossdock · Bayline Distribution',
        'Unassigned',
        '',
      ],
    ]);
    // Board order: the new load's stops come first among the stop events.
    expect(week.data.find((e) => e.readOnly)?.loadId).toBe(load.id);

    const values = (await rosa.get('/api/v1/planner/stop-values').expect(200)).body.data as PlannerStopValuesDto;
    expect(values.sampleEvent).toMatchObject({
      loadId: load.id,
      title: `L-${load.loadNumber} · Stockton, CA`,
      start: '09:00',
      end: '11:00',
    });
    expect(values.customer).toContain('Bayline Distribution');
  });
});
