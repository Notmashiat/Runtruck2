import { employeeContractKpis, onboardingKpis, toEmployeeContractRow, toOnboardingRow } from '@runtruck/calculations';
import { hashPassword, schema } from '@runtruck/database';
import type { RoleKey } from '@runtruck/permissions';
import type { EmployeeContractRow, EmployeeContractsMeta, OnboardingCaseRow, OnboardingCasesMeta } from '@runtruck/types';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchesQuery } from '../src/common/list/list-query.js';
import { createTestContext, TEST_PASSWORD, type TestContext } from './helpers.js';

// HR read views (docs/api/hr.md §6): GET /hr/contracts and GET /hr/onboarding against the
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

// A demo-organization member holding one of the organization's default roles (07 §2).
async function memberWithRole(role: RoleKey, memberNumber: string): Promise<typeof admin> {
  const db = t.db.db;
  const org = t.orgs.demoOrganizationId;
  const email = `${role}.hr@sunridgefreight.test`;
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

const contracts = (path: string, agent = admin) => get<EmployeeContractRow[], EmployeeContractsMeta>(path, agent);
const onboarding = (path: string, agent = admin) => get<OnboardingCaseRow[], OnboardingCasesMeta>(path, agent);

describe('GET /hr/contracts', () => {
  it('returns the seeded contracts in Runtruck1 order (hr.md §2.5)', async () => {
    const { data, meta } = await contracts('/hr/contracts?limit=500');
    expect(
      data.map((c) => [c.employee.fullName, c.role, c.contractType, c.status, c.startsOn, c.renewsOn, c.payBasis, c.payRateCents, c.payPercentBp]),
    ).toEqual([
      ['Marcus Hale', 'company_driver', 'w2', 'active', '2022-03-14', '2027-03-14', 'per_mile', 62, null],
      ['Dara Whitfield', 'company_driver', 'w2', 'active', '2021-08-02', '2027-08-02', 'per_mile', 60, null],
      ['Ellis Nakamura', 'company_driver', 'w2', 'renewal_due', '2023-10-01', '2026-10-01', 'percent_of_line_haul', null, 2500],
      ['Priya Raman', 'company_driver', 'w2', 'renewal_due', '2024-09-20', '2026-09-20', 'per_mile', 58, null],
      ['Ana Cortez', 'company_driver', 'w2', 'active', '2026-01-12', '2027-01-12', 'per_mile', 58, null],
      ['Tobias Frey', 'owner_operator', 'lease_purchase', 'expiring', '2023-11-15', '2026-11-15', 'per_mile', 118, null],
      ['Rosa Medina', 'dispatcher', 'w2', 'active', '2020-06-06', '2027-06-06', 'annual_salary', 6800000, null],
      ['Luis Ortega', 'mechanic', 'w2', 'active', '2023-02-09', '2027-02-09', 'hourly', 3450, null],
      ['Evan Brooks', 'dispatcher', 'w2', 'active', '2026-07-27', '2027-07-27', 'annual_salary', 5200000, null],
      ['Jamal Reed', 'company_driver', 'w2', 'draft', '2026-09-08', '2027-09-08', 'per_mile', 56, null],
    ]);
    expect(Object.keys(data[0] ?? {}).sort()).toEqual(
      ['contractType', 'employee', 'id', 'payBasis', 'payPercentBp', 'payRateCents', 'renewsOn', 'role', 'startsOn', 'status'].sort(),
    );
    expect(meta).toMatchObject({ total: 10, limit: 500, offset: 0 });
    const byName = (name: string) => data.find((c) => c.employee.fullName === name);
    const entry = (name: string, lastName: string) => {
      const c = byName(name);
      return { contractId: c?.id, employeeId: c?.employee.id, fullName: name, lastName, contractType: c?.contractType, startsOn: c?.startsOn, renewsOn: c?.renewsOn };
    };
    expect(meta.summary).toEqual({
      asOf: '2026-09-03',
      contractCount: 10,
      activeCount: 6,
      renewalsDue: [entry('Priya Raman', 'Raman'), entry('Ellis Nakamura', 'Nakamura')],
      ownerOperators: [entry('Tobias Frey', 'Frey')],
      drafts: [entry('Jamal Reed', 'Reed')],
    });
  });

  it('renders exactly Runtruck1’s CONTRACTS strings and KPIs through the shared view-model (hr.md §4.1)', async () => {
    const { data, meta } = await contracts('/hr/contracts?limit=500');
    expect(data.map((c) => toEmployeeContractRow(c, meta.summary.asOf)).map(({ ref, ...row }) => [...Object.values(row), ref.tone])).toEqual([
      ['Marcus Hale', 'Company driver', 'W-2', 'Mar 14, 2022', 'Mar 14, 2027', '$0.62 / mi', 'Active', 'green'],
      ['Dara Whitfield', 'Company driver', 'W-2', 'Aug 2, 2021', 'Aug 2, 2027', '$0.60 / mi', 'Active', 'green'],
      ['Ellis Nakamura', 'Company driver', 'W-2', 'Oct 1, 2023', 'Oct 1', '25% of line haul', 'Renewal due', 'amber'],
      ['Priya Raman', 'Company driver', 'W-2', 'Sep 20, 2024', 'Sep 20', '$0.58 / mi', 'Renewal due', 'amber'],
      ['Ana Cortez', 'Company driver', 'W-2', 'Jan 12', 'Jan 12, 2027', '$0.58 / mi', 'Active', 'green'],
      ['Tobias Frey', 'Owner-operator', 'Lease-purchase', 'Nov 15, 2023', 'Nov 15', '$1.18 / mi', 'Expiring', 'amber'],
      ['Rosa Medina', 'Dispatcher', 'W-2', 'Jun 6, 2020', 'Jun 6, 2027', '$68,000 / yr', 'Active', 'green'],
      ['Luis Ortega', 'Mechanic', 'W-2', 'Feb 9, 2023', 'Feb 9, 2027', '$34.50 / hr', 'Active', 'green'],
      ['Evan Brooks', 'Dispatcher', 'W-2', 'Jul 27', 'Jul 27, 2027', '$52,000 / yr', 'Active', 'green'],
      ['Jamal Reed', 'Company driver', 'W-2', 'Sep 8', 'Sep 8, 2027', '$0.56 / mi', 'Draft', 'gray'],
    ]);
    expect(employeeContractKpis(meta.summary)).toEqual([
      { label: 'Active contracts', value: '6', note: '10 on file' },
      { label: 'Renewals due (30 d)', value: '2', note: 'Raman Sep 20 · Nakamura Oct 1' },
      { label: 'Owner-operators', value: '1', note: 'Frey · lease-purchase ends Nov 15' },
      { label: 'Drafts', value: '1', note: 'Reed · starts Sep 8' },
    ]);
  });

  it('filters q over the view-model strings exactly as the web does; the summary ignores q', async () => {
    const all = await contracts('/hr/contracts?limit=500');
    const names = async (q: string) => (await contracts(`/hr/contracts?limit=500&q=${encodeURIComponent(q)}`)).data.map((c) => c.employee.fullName);
    expect(await names('2027')).toHaveLength(7);
    expect(await names('w-2')).toHaveLength(9);
    expect(await names('w2')).toEqual([]);
    expect(await names('lease')).toEqual(['Tobias Frey']);
    for (const q of ['2027', 'w-2', 'w2', 'lease', '$0.58', '% of line', 'renewal', 'sep 2', 'owner_operator']) {
      const res = await contracts(`/hr/contracts?limit=500&q=${encodeURIComponent(q)}`);
      const expected = all.data.filter((c) => matchesQuery(toEmployeeContractRow(c, all.meta.summary.asOf), q)).map((c) => c.employee.fullName);
      expect(
        res.data.map((c) => c.employee.fullName),
        q,
      ).toEqual(expected);
      expect(res.meta.total).toBe(expected.length);
      expect(res.meta.summary).toEqual(all.meta.summary);
    }
    // Ids, enum values and cents are never searched.
    expect((await contracts(`/hr/contracts?q=${all.data[0]?.id ?? ''}`)).meta.total).toBe(0);
    expect((await contracts('/hr/contracts?q=6800000')).meta.total).toBe(0);
  });

  it('filters by status without changing the summary', async () => {
    const all = await contracts('/hr/contracts');
    const due = await contracts('/hr/contracts?status=renewal_due');
    expect(due.data.map((c) => c.employee.fullName)).toEqual(['Ellis Nakamura', 'Priya Raman']);
    expect(due.meta.total).toBe(2);
    expect(due.meta.summary).toEqual(all.meta.summary);
    expect((await contracts('/hr/contracts?status=draft&q=reed')).data.map((c) => c.employee.fullName)).toEqual(['Jamal Reed']);
  });

  it('pages with limit and offset; total counts every match', async () => {
    const page = await contracts('/hr/contracts?limit=2&offset=3');
    expect(page.data.map((c) => c.employee.fullName)).toEqual(['Priya Raman', 'Ana Cortez']);
    expect(page.meta).toMatchObject({ total: 10, limit: 2, offset: 3 });
    expect((await contracts('/hr/contracts?offset=50')).data).toEqual([]);
    expect((await contracts('/hr/contracts?offset=50')).meta.total).toBe(10);
    expect((await contracts('/hr/contracts')).meta.limit).toBe(100);
    // Unknown parameters are ignored.
    expect((await contracts('/hr/contracts?organizationId=x&foo=1')).meta.total).toBe(10);
  });
});

describe('GET /hr/onboarding', () => {
  it('returns the seeded cases in Runtruck1 order (hr.md §3.5)', async () => {
    const { data, meta } = await onboarding('/hr/onboarding?limit=500');
    expect(
      data.map((o) => [
        o.candidateName,
        o.role,
        o.stage,
        o.startedOn,
        o.owner.fullName,
        o.progressPercent,
        o.nextStep,
        o.nextStepOn,
        o.completedOn,
        o.pendingDocumentLabels,
        o.employeeId !== null,
      ]),
    ).toEqual([
      ['Jamal Reed', 'company_driver', 'orientation', '2026-08-17', 'Rosa Medina', 85, 'Ride-along with Ana Cortez', '2026-09-05', null, [], true],
      ['Sofia Nguyen', 'company_driver', 'road_test', '2026-08-24', 'Luis Ortega', 60, 'Road test in T-103', '2026-09-04', null, [], false],
      [
        'Derek Holt',
        'owner_operator',
        'background_check',
        '2026-08-28',
        'Rosa Medina',
        35,
        'Waiting on MVR consent and insurance certificate',
        null,
        null,
        ['MVR consent', 'insurance certificate'],
        false,
      ],
      ['Kevin Brandt', 'company_driver', 'background_check', '2026-09-01', 'Rosa Medina', 30, 'Waiting on medical card copy', null, null, ['medical card'], false],
      ['Maya Patel', 'company_driver', 'application', '2026-09-02', 'Rosa Medina', 10, 'Phone screen', '2026-09-04', null, [], false],
      ['Evan Brooks', 'dispatcher', 'complete', '2026-07-13', 'Rosa Medina', 100, '90-day review', '2026-10-25', '2026-07-27', [], true],
    ]);
    expect(meta).toMatchObject({ total: 6, limit: 500, offset: 0 });
    expect(meta.summary).toEqual({
      asOf: '2026-09-03',
      weekStart: '2026-08-31',
      weekEnd: '2026-09-06',
      quarterStart: '2026-07-01',
      caseCount: 6,
      inProgressCount: 5,
      inOrientationCount: 1,
      startedThisWeekCount: 2,
      awaitingDocuments: [
        { caseId: data[2]?.id, candidateName: 'Derek Holt', firstPendingLabel: 'MVR consent' },
        { caseId: data[3]?.id, candidateName: 'Kevin Brandt', firstPendingLabel: 'medical card' },
      ],
      completedThisQuarterCount: 1,
    });
  });

  it('renders exactly Runtruck1’s ONBOARDING strings and KPIs (hr.md §4.2)', async () => {
    const { data, meta } = await onboarding('/hr/onboarding?limit=500');
    expect(data.map(toOnboardingRow).map(({ ref, ...row }) => [...Object.values(row), ref.tone])).toEqual([
      ['Jamal Reed', 'Company driver', 'Orientation', 'Aug 17', 'Rosa Medina', 85, 'Ride-along with Ana Cortez · Sep 5', false, 'blue'],
      ['Sofia Nguyen', 'Company driver', 'Road test', 'Aug 24', 'Luis Ortega', 60, 'Road test in T-103 · Sep 4', false, 'blue'],
      ['Derek Holt', 'Owner-operator', 'Background check', 'Aug 28', 'Rosa Medina', 35, 'Waiting on MVR consent and insurance certificate', true, 'amber'],
      ['Kevin Brandt', 'Company driver', 'Background check', 'Sep 1', 'Rosa Medina', 30, 'Waiting on medical card copy', true, 'amber'],
      ['Maya Patel', 'Company driver', 'Application', 'Sep 2', 'Rosa Medina', 10, 'Phone screen · Sep 4', false, 'gray'],
      ['Evan Brooks', 'Dispatcher', 'Complete', 'Jul 13', 'Rosa Medina', 100, '90-day review · Oct 25', false, 'green'],
    ]);
    expect(onboardingKpis(meta.summary)).toEqual([
      { label: 'In progress', value: '5', note: '1 in orientation' },
      { label: 'Starting this week', value: '2', note: 'Opened since Mon Aug 31' },
      { label: 'Awaiting documents', value: '2', note: 'MVR consent · medical card' },
      { label: 'Completed this quarter', value: '1', note: 'Since Jul 1' },
    ]);
  });

  it('filters q over the view-model strings; progress matches as digits, booleans never', async () => {
    const all = await onboarding('/hr/onboarding?limit=500');
    const names = async (q: string) => (await onboarding(`/hr/onboarding?q=${encodeURIComponent(q)}`)).data.map((o) => o.candidateName);
    expect(await names('85')).toEqual(['Jamal Reed']);
    expect(await names('sep 4')).toEqual(['Sofia Nguyen', 'Maya Patel']);
    expect(await names('true')).toEqual([]);
    for (const q of ['85', 'sep 4', 'true', 'rosa', 'background', 'owner-operator', '100', 'background_check']) {
      const res = await onboarding(`/hr/onboarding?q=${encodeURIComponent(q)}`);
      expect(
        res.data.map((o) => o.candidateName),
        q,
      ).toEqual(all.data.filter((o) => matchesQuery(toOnboardingRow(o), q)).map((o) => o.candidateName));
      expect(res.meta.summary).toEqual(all.meta.summary);
    }
  });

  it('filters by stage without changing the summary, and pages', async () => {
    const all = await onboarding('/hr/onboarding');
    const complete = await onboarding('/hr/onboarding?stage=complete');
    expect(complete.data.map((o) => o.candidateName)).toEqual(['Evan Brooks']);
    expect(complete.meta.total).toBe(1);
    expect(complete.meta.summary).toEqual(all.meta.summary);
    const page = await onboarding('/hr/onboarding?limit=2&offset=4');
    expect(page.data.map((o) => o.candidateName)).toEqual(['Maya Patel', 'Evan Brooks']);
    expect(page.meta).toMatchObject({ total: 6, limit: 2, offset: 4 });
  });
});

describe('HR validation', () => {
  it.each([
    ['/hr/contracts?limit=0', 'limit'],
    ['/hr/contracts?limit=501', 'limit'],
    ['/hr/contracts?offset=-1', 'offset'],
    ['/hr/contracts?offset=1.5', 'offset'],
    ['/hr/contracts?status=bogus', 'status'],
    ['/hr/contracts?status=active&status=draft', 'status'],
    [`/hr/contracts?q=${'x'.repeat(201)}`, 'q'],
    ['/hr/contracts?limit=abc', 'limit'],
    ['/hr/contracts?q=a&q=b', 'q'],
    ['/hr/onboarding?limit=0', 'limit'],
    ['/hr/onboarding?limit=501', 'limit'],
    ['/hr/onboarding?offset=-1', 'offset'],
    ['/hr/onboarding?offset=1.5', 'offset'],
    [`/hr/onboarding?q=${'x'.repeat(201)}`, 'q'],
    ['/hr/onboarding?stage=bogus', 'stage'],
    ['/hr/onboarding?stage=complete&stage=application', 'stage'],
  ])('%s → 400 naming %s', async (path, param) => {
    const res = await admin.get(`/api/v1${path}`).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.requestId).toBeTruthy();
    expect(res.body.error.issues.map((i: { path: string }) => i.path)).toContain(param);
  });
});

describe('HR access control', () => {
  const PATHS = ['/hr/contracts', '/hr/onboarding'];

  it('requires a session', async () => {
    for (const path of PATHS) {
      const res = await request(t.server).get(`/api/v1${path}`).expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('refuses the Dispatcher, Accounting and Driver members (no hr.view)', async () => {
    for (const user of ['dispatcher', 'accounting', 'driver'] as const) {
      const agent = await t.as(user);
      for (const path of PATHS) {
        const res = await agent.get(`/api/v1${path}`).expect(403);
        expect(res.body.error).toMatchObject({ code: 'FORBIDDEN' });
        expect(JSON.stringify(res.body)).not.toContain('Marcus');
      }
    }
  });

  it('follows the role matrix of 07 §2: the Manager reads both, the Maintenance member neither', async () => {
    const manager = await memberWithRole('manager', '100482790');
    const maintenance = await memberWithRole('maintenance', '100482791');
    for (const path of PATHS) {
      expect((await manager.get(`/api/v1${path}?limit=500`).expect(200)).body.meta.total, path).toBeGreaterThan(0);
      const res = await maintenance.get(`/api/v1${path}`).expect(403);
      expect(res.body.error.code, path).toBe('FORBIDDEN');
    }
  });

  it('shows another organization only its own contracts and cases, never Sunridge’s', async () => {
    const other = await t.as('otherAdmin');
    const c = await contracts('/hr/contracts?limit=500', other);
    expect(c.data.map((x) => [x.employee.fullName, x.status, x.payRateCents])).toEqual([['Terry Wheeler', 'active', 55]]);
    expect(c.meta.summary).toEqual({ asOf: '2026-09-03', contractCount: 1, activeCount: 1, renewalsDue: [], ownerOperators: [], drafts: [] });
    expect((await contracts('/hr/contracts?q=hale', other)).meta.total).toBe(0);

    const o = await onboarding('/hr/onboarding?limit=500', other);
    expect(o.data.map((x) => [x.candidateName, x.owner.fullName, x.pendingDocumentLabels])).toEqual([['Riley Stone', 'Morgan Hayes', ['MVR consent']]]);
    expect(o.meta.summary).toMatchObject({ caseCount: 1, inProgressCount: 1, inOrientationCount: 0, completedThisQuarterCount: 0 });
    expect(JSON.stringify([c, o])).not.toMatch(/Sunridge|Rosa Medina|Derek Holt|Jamal Reed/);

    // And Sunridge never sees the other tenant's rows.
    expect(JSON.stringify(await contracts('/hr/contracts?limit=500'))).not.toContain('Terry Wheeler');
    expect(JSON.stringify(await onboarding('/hr/onboarding?limit=500'))).not.toContain('Riley Stone');
  });

  it('writes no audit rows or events for reads (hr.md §1.6)', async () => {
    const count = async () => {
      const r = await t.db.db.execute<{ audits: number; events: number }>(
        sql`SELECT (SELECT count(*) FROM audit_logs)::int AS audits, (SELECT count(*) FROM events)::int AS events`,
      );
      return r.rows[0];
    };
    const before = await count();
    await contracts('/hr/contracts');
    await onboarding('/hr/onboarding');
    expect(await count()).toEqual(before);
  });
});
