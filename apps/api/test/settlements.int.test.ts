import { payrollCardTitle, payrollKpis, settlementViewRow } from '@runtruck/calculations';
import { schema } from '@runtruck/database';
import type { SettlementRow } from '@runtruck/types';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext, WEB_ORIGIN } from './helpers.js';

// GET /settlements and POST /settlements/approve (docs/api/settlements.md §2–§4) against
// the demo seed, today = 2026-09-03. The tests in this file run in order: refusals first
// (nothing may be written), then the approval and its idempotent repeat.

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(async () => {
  await t.close();
});

interface Row {
  [key: string]: unknown;
}

const url = '/api/v1/settlements';
const approveUrl = `${url}/approve`;

const SEED_ROWS = [
  ['Marcus Hale', '$0.62 / mi', 4, 2140, 132_600, -14_200, 118_400, 'ready', null],
  ['Dara Whitfield', '$0.60 / mi', 3, 1980, 118_800, -9_600, 109_200, 'ready', null],
  ['Ellis Nakamura', '25% of line haul', 3, 1760, 145_500, -21_000, 124_500, 'on_hold', 'fuel'],
  ['Priya Raman', '$0.58 / mi', 2, 1420, 82_400, -6_400, 76_000, 'ready', null],
  ['Ana Cortez', '$0.58 / mi', 2, 1180, 68_400, 0, 68_400, 'paid', null],
];

const SEED_SUMMARY = {
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

const shape = (rows: Row[]) => rows.map((r) => [r.driverName, r.payBasisLabel, r.loadCount, r.miles, r.grossCents, r.deductionsCents, r.netCents, r.status, r.holdReason]);

// Runtruck1 data/mock.ts SETTLEMENTS, verbatim, with SETTLE_TAG's chip as the Tag tone. After
// "Approve all" Runtruck1 renders every Ready row as Approved (still tag-accent, blue).
const TONE: Record<string, string> = { Ready: 'blue', Approved: 'blue', Paid: 'green', 'Hold · fuel': 'amber' };
const R1_SETTLEMENTS = [
  { name: 'Marcus Hale', basis: '$0.62 / mi', loads: '4', miles: '2,140', gross: '$1,326', ded: '-$142', net: '$1,184', status: 'Ready' },
  { name: 'Dara Whitfield', basis: '$0.60 / mi', loads: '3', miles: '1,980', gross: '$1,188', ded: '-$96', net: '$1,092', status: 'Ready' },
  { name: 'Ellis Nakamura', basis: '25% of line haul', loads: '3', miles: '1,760', gross: '$1,455', ded: '-$210', net: '$1,245', status: 'Hold · fuel' },
  { name: 'Priya Raman', basis: '$0.58 / mi', loads: '2', miles: '1,420', gross: '$824', ded: '-$64', net: '$760', status: 'Ready' },
  { name: 'Ana Cortez', basis: '$0.58 / mi', loads: '2', miles: '1,180', gross: '$684', ded: '—', net: '$684', status: 'Paid' },
];
const r1Payroll = (approved: boolean) =>
  R1_SETTLEMENTS.map((x) => {
    const status = approved && x.status === 'Ready' ? 'Approved' : x.status;
    return { ...x, status, tone: TONE[status] };
  });

// Runtruck1 PayrollTab's KPI tiles for its `approved` flag.
const r1PayrollKpis = (approved: boolean) => [
  { label: 'Drivers', value: '5', note: approved ? 'Approved for payment' : '3 ready to approve' },
  { label: 'Gross', value: '$5,477', note: 'Week of Sep 1' },
  { label: 'Deductions', value: '$512', note: 'Fuel advances and escrow' },
  { label: 'Net payable', value: '$4,965', note: approved ? 'Approved' : 'Awaiting approval' },
];

// Approval side effects written for the demo organization.
async function approvalWrites() {
  const org = t.orgs.demoOrganizationId;
  const audits = await t.db.db
    .select()
    .from(schema.auditLogs)
    .where(and(eq(schema.auditLogs.organizationId, org), eq(schema.auditLogs.action, 'SETTLEMENT_APPROVED')));
  const events = await t.db.db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.organizationId, org), eq(schema.events.type, 'SettlementApproved')));
  return { audits, events };
}

async function demoStatuses() {
  const rows = await t.db.db
    .select({ status: schema.settlements.status })
    .from(schema.settlements)
    .where(eq(schema.settlements.organizationId, t.orgs.demoOrganizationId));
  return rows.map((r) => r.status).sort();
}

describe('GET /settlements', () => {
  it('without a period lists the period containing today, in roster order', async () => {
    const agent = await t.as('admin');
    const res = await agent.get(`${url}?limit=500`).expect(200);
    const rows = res.body.data as Row[];
    expect(shape(rows)).toEqual(SEED_ROWS);
    expect(rows[0]).toEqual({
      id: expect.any(String),
      driverId: expect.any(String),
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
    });
    expect(rows[2]).toMatchObject({ payBasis: 'percent_of_line_haul', payRateCents: null, payPercentBp: 2500 });
    expect(res.body.meta).toEqual({ total: 5, limit: 500, offset: 0, summary: SEED_SUMMARY });
  });

  it("renders Runtruck1's SETTLEMENTS rows, card title and KPI tiles through the shared view models (§5)", async () => {
    const agent = await t.as('admin');
    const res = await agent.get(`${url}?limit=500`).expect(200);
    expect((res.body.data as SettlementRow[]).map(settlementViewRow)).toEqual(r1Payroll(false));
    expect(payrollCardTitle(res.body.meta.summary.period)).toBe('Driver settlements · week of Sep 1');
    expect(payrollKpis(res.body.meta.summary)).toEqual(r1PayrollKpis(false));
  });

  it('with ?periodStart=2026-09-01 lists the same period', async () => {
    const agent = await t.as('admin');
    const res = await agent.get(`${url}?periodStart=2026-09-01`).expect(200);
    expect(shape(res.body.data as Row[])).toEqual(SEED_ROWS);
    expect(res.body.meta).toEqual({ total: 5, limit: 100, offset: 0, summary: SEED_SUMMARY });
  });

  it('an unknown period is an empty list, not a 404', async () => {
    const agent = await t.as('admin');
    const res = await agent.get(`${url}?periodStart=2026-08-25`).expect(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.summary).toMatchObject({ period: { start: '2026-08-25', end: null }, driverCount: 0, netCents: 0, allApproved: false });
  });

  it('pages and searches the view rows', async () => {
    const agent = await t.as('admin');
    const page = await agent.get(`${url}?limit=2&offset=3`).expect(200);
    expect((page.body.data as Row[]).map((r) => r.driverName)).toEqual(['Priya Raman', 'Ana Cortez']);
    expect(page.body.meta).toMatchObject({ total: 5, summary: { driverCount: 5 } });
    const ready = await agent.get(`${url}?q=ready`).expect(200);
    expect((ready.body.data as Row[]).map((r) => r.driverName)).toEqual(['Marcus Hale', 'Dara Whitfield', 'Priya Raman']);
    const hold = await agent.get(url).query({ q: 'hold · fuel' }).expect(200);
    expect((hold.body.data as Row[]).map((r) => r.driverName)).toEqual(['Ellis Nakamura']);
    expect((await agent.get(url).query({ q: '-$142' }).expect(200)).body.meta.total).toBe(1);
  });

  it('validates periodStart and paging', async () => {
    const agent = await t.as('admin');
    for (const qs of ['periodStart=2026-02-30', 'periodStart=2026-9-1', 'periodStart=0000-01-01', 'limit=501']) {
      expect((await agent.get(`${url}?${qs}`).expect(400)).body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('requires a session and settlements.view', async () => {
    expect((await request(t.server).get(url).expect(401)).body.error.code).toBe('UNAUTHORIZED');
    expect((await (await t.as('dispatcher')).get(url).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await (await t.as('accounting')).get(url).expect(200)).body.meta.total).toBe(5);
  });

  it("isolates tenants: Test Carrier Co's same-dated period holds only its own settlement", async () => {
    const other = await t.as('otherAdmin');
    const res = await other.get(`${url}?periodStart=2026-09-01`).expect(200);
    expect((res.body.data as Row[]).map((r) => [r.driverName, r.grossCents, r.status])).toEqual([['Terry Wheeler', 49_500, 'ready']]);
    expect(res.body.meta.summary).toMatchObject({ driverCount: 1, grossCents: 49_500, readyCount: 1 });
  });
});

describe('POST /settlements/approve: refusals write nothing', () => {
  it('401 without a session', async () => {
    const res = await request(t.server).post(approveUrl).send({ periodStart: '2026-09-01' }).expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('403 without settlements.approve (Dispatcher, Driver)', async () => {
    for (const user of ['dispatcher', 'driver'] as const) {
      const agent = await t.as(user);
      expect((await agent.post(approveUrl).send({ periodStart: '2026-09-01' }).expect(403)).body.error.code).toBe('FORBIDDEN');
    }
  });

  it('403 CROSS_ORIGIN_REJECTED from a foreign browser origin', async () => {
    const agent = await t.as('admin');
    const res = await agent.post(approveUrl).set('Origin', 'https://evil.example').send({ periodStart: '2026-09-01' }).expect(403);
    expect(res.body.error.code).toBe('CROSS_ORIGIN_REJECTED');
  });

  it('403 with settlements.approve but without settlements.view (the response lists the period, §3)', async () => {
    const org = t.orgs.demoOrganizationId;
    const [role] = await t.db.db
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(and(eq(schema.roles.organizationId, org), eq(schema.roles.key, 'dispatcher')));
    const [permission] = await t.db.db.select({ id: schema.permissions.id }).from(schema.permissions).where(eq(schema.permissions.key, 'settlements.approve'));
    if (!role || !permission) throw new Error('Dispatcher role or settlements.approve permission missing from the fixtures');
    // Grant the Dispatcher role settlements.approve alone for this test (permissions are read per request).
    await t.db.db.insert(schema.rolePermissions).values({ roleId: role.id, permissionId: permission.id });
    try {
      const agent = await t.as('dispatcher');
      const me = await agent.get('/api/v1/me').expect(200);
      expect(me.body.data.permissions).toContain('settlements.approve');
      expect(me.body.data.permissions).not.toContain('settlements.view');
      const res = await agent.post(approveUrl).set('Origin', WEB_ORIGIN).send({ periodStart: '2026-09-01' }).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    } finally {
      await t.db.db
        .delete(schema.rolePermissions)
        .where(and(eq(schema.rolePermissions.roleId, role.id), eq(schema.rolePermissions.permissionId, permission.id)));
    }
  });

  it('400 for a missing or invalid period and for any other body key', async () => {
    const agent = await t.as('admin');
    const bodies: [unknown, string][] = [
      [{}, 'periodStart'],
      [{ periodStart: '2026-02-30' }, 'periodStart'],
      [{ periodStart: 20260901 }, 'periodStart'],
      [{ periodStart: '2026-09-01', organizationId: t.orgs.otherOrganizationId }, ''],
      [{ periodStart: '2026-09-01', settlementIds: [] }, ''],
    ];
    for (const [body, path] of bodies) {
      const res = await agent.post(approveUrl).set('Origin', WEB_ORIGIN).send(body as object).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.issues[0].path).toBe(path);
    }
  });

  it('404 SETTLEMENT_PERIOD_NOT_FOUND for an unknown period', async () => {
    const agent = await t.as('admin');
    const res = await agent.post(approveUrl).send({ periodStart: '2026-08-25' }).expect(404);
    expect(res.body.error).toMatchObject({ code: 'SETTLEMENT_PERIOD_NOT_FOUND', message: 'Pay period was not found.' });
  });

  it('left every demo settlement untouched and wrote no audit or event row', async () => {
    expect(await demoStatuses()).toEqual(['on_hold', 'paid', 'ready', 'ready', 'ready']);
    const { audits, events } = await approvalWrites();
    expect(audits).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});

describe('POST /settlements/approve: tenant isolation', () => {
  it("another organization's approval of the same date moves only its own settlement", async () => {
    const other = await t.as('otherAdmin');
    const res = await other.post(approveUrl).set('Origin', WEB_ORIGIN).send({ periodStart: '2026-09-01' }).expect(200);
    expect((res.body.data as Row[]).map((r) => [r.driverName, r.status])).toEqual([['Terry Wheeler', 'approved']]);
    expect(res.body.meta).toMatchObject({ total: 1, approvedNow: 1, summary: { readyCount: 0, approvedCount: 1, allApproved: true } });
    // Sunridge's settlements, audit trail and outbox are untouched.
    expect(await demoStatuses()).toEqual(['on_hold', 'paid', 'ready', 'ready', 'ready']);
    const { audits, events } = await approvalWrites();
    expect(audits).toHaveLength(0);
    expect(events).toHaveLength(0);
    const otherAudits = await t.db.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.organizationId, t.orgs.otherOrganizationId));
    expect(otherAudits.filter((a) => a.action === 'SETTLEMENT_APPROVED')).toHaveLength(1);
  });

  it("a period only Sunridge has is 404 SETTLEMENT_PERIOD_NOT_FOUND for Test Carrier Co, and Sunridge's ready row stays ready", async () => {
    const org = t.orgs.demoOrganizationId;
    const [driver] = await t.db.db.select({ id: schema.drivers.id }).from(schema.drivers).where(eq(schema.drivers.organizationId, org)).limit(1);
    if (!driver) throw new Error('No demo driver');
    // A Sunridge-only pay period (the demo seed has one period, which Test Carrier Co shares by date).
    const [extra] = await t.db.db
      .insert(schema.settlements)
      .values({ organizationId: org, driverId: driver.id, periodStart: '2026-08-18', periodEnd: '2026-08-24', payBasis: 'per_mile', payRateCents: 62, status: 'ready' })
      .returning({ id: schema.settlements.id });
    if (!extra) throw new Error('Insert failed');
    try {
      const other = await t.as('otherAdmin');
      const res = await other.post(approveUrl).set('Origin', WEB_ORIGIN).send({ periodStart: '2026-08-18' }).expect(404);
      expect(res.body.error).toMatchObject({ code: 'SETTLEMENT_PERIOD_NOT_FOUND', message: 'Pay period was not found.' });
      // Identical to a period nobody has.
      const unknown = await other.post(approveUrl).set('Origin', WEB_ORIGIN).send({ periodStart: '2026-08-11' }).expect(404);
      expect(unknown.body.error.code).toBe(res.body.error.code);
      expect(unknown.body.error.message).toBe(res.body.error.message);
      // Nor can it read Sunridge's period.
      const read = await other.get(`${url}?periodStart=2026-08-18`).expect(200);
      expect(read.body.data).toEqual([]);
      const [stored] = await t.db.db.select({ status: schema.settlements.status }).from(schema.settlements).where(eq(schema.settlements.id, extra.id));
      expect(stored?.status).toBe('ready');
      const { audits, events } = await approvalWrites();
      expect(audits).toHaveLength(0);
      expect(events).toHaveLength(0);
    } finally {
      await t.db.db.delete(schema.settlements).where(eq(schema.settlements.id, extra.id));
    }
  });
});

describe('POST /settlements/approve: approval', () => {
  it('moves the three ready settlements to approved, audited and announced, and returns the period', async () => {
    const agent = await t.as('admin');
    const me = await agent.get('/api/v1/me').expect(200);
    const userId = me.body.data.user.id as string;

    const res = await agent.post(approveUrl).set('Origin', WEB_ORIGIN).send({ periodStart: '2026-09-01' }).expect(200);
    const rows = res.body.data as Row[];
    expect(rows.map((r) => [r.driverName, r.status])).toEqual([
      ['Marcus Hale', 'approved'],
      ['Dara Whitfield', 'approved'],
      ['Ellis Nakamura', 'on_hold'],
      ['Priya Raman', 'approved'],
      ['Ana Cortez', 'paid'],
    ]);
    const approvedAt = rows[0]?.approvedAt as string;
    // ClockService.now: the pinned demo date (D4) at the real time of day in the org's zone.
    expect(approvedAt).toMatch(/^2026-09-0[34]T\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(rows.filter((r) => r.status === 'approved').every((r) => r.approvedAt === approvedAt)).toBe(true);
    expect(rows[2]?.approvedAt).toBeNull();
    expect(rows[4]?.approvedAt).toBeNull();
    expect(res.body.meta).toEqual({
      total: 5,
      limit: 500,
      offset: 0,
      approvedNow: 3,
      summary: { ...SEED_SUMMARY, readyCount: 0, approvedCount: 3, allApproved: true },
    });

    const { audits, events } = await approvalWrites();
    const byEntity = (id: unknown) => rows.find((r) => r.id === id);
    expect(audits.map((a) => a.entityLabel).sort()).toEqual(['Dara Whitfield · 2026-09-01', 'Marcus Hale · 2026-09-01', 'Priya Raman · 2026-09-01']);
    for (const a of audits) {
      expect(a).toMatchObject({ actorUserId: userId, entityType: 'settlement', previous: { status: 'ready' }, next: { status: 'approved', approvedAt, approvedByUserId: userId } });
      expect(a.occurredAt.toISOString()).toBe(approvedAt);
      expect(byEntity(a.entityId)?.status).toBe('approved');
      expect(a.requestId).toBeTruthy();
    }
    expect(events).toHaveLength(3);
    for (const e of events) {
      const row = byEntity(e.aggregateId);
      expect(e).toMatchObject({ aggregateType: 'settlement', actorUserId: userId, publishedAt: null });
      expect(e.payload).toEqual({ settlementId: e.aggregateId, driverId: row?.driverId, periodStart: '2026-09-01' });
      expect(e.occurredAt.toISOString()).toBe(approvedAt);
    }

    // Persisted: approved_by and the stored status survive a reload.
    const stored = await t.db.db
      .select({ status: schema.settlements.status, approvedByUserId: schema.settlements.approvedByUserId })
      .from(schema.settlements)
      .where(and(eq(schema.settlements.organizationId, t.orgs.demoOrganizationId), eq(schema.settlements.status, 'approved')));
    expect(stored).toHaveLength(3);
    expect(stored.every((s) => s.approvedByUserId === userId)).toBe(true);
    const reread = await agent.get(url).expect(200);
    expect(reread.body.meta.summary).toMatchObject({ readyCount: 0, approvedCount: 3, allApproved: true });
    expect((await agent.get(`${url}?q=approved`).expect(200)).body.meta.total).toBe(3);

    // What Payroll renders after "Approve all": Runtruck1's approved view (accounting.md §7.1).
    expect((rows as unknown as SettlementRow[]).map(settlementViewRow)).toEqual(r1Payroll(true));
    expect(payrollKpis(res.body.meta.summary)).toEqual(r1PayrollKpis(true));
    expect(payrollCardTitle(res.body.meta.summary.period)).toBe('Driver settlements · week of Sep 1');
    expect((reread.body.data as SettlementRow[]).map(settlementViewRow)).toEqual(r1Payroll(true));
  });

  it('is idempotent: a repeat returns the same period, approvedNow 0, and writes nothing', async () => {
    const before = await (await t.as('admin')).get(`${url}?limit=500`).expect(200);
    const agent = await t.as('accounting');
    const res = await agent.post(approveUrl).send({ periodStart: '2026-09-01' }).expect(200);
    expect(res.body.data).toEqual(before.body.data);
    expect(res.body.meta).toEqual({ ...before.body.meta, approvedNow: 0 });
    const { audits, events } = await approvalWrites();
    expect(audits).toHaveLength(3);
    expect(events).toHaveLength(3);
  });
});
