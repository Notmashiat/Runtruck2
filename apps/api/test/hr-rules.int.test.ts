import type { EmployeeContractRow, EmployeeContractsMeta, OnboardingCaseRow, OnboardingCasesMeta } from '@runtruck/types';
import { onboardingKpis } from '@runtruck/calculations';
import { schema } from '@runtruck/database';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './helpers.js';

// The HR summary rules at their boundaries (docs/api/hr.md §1.1, §2.4, §3.4, §6 "Unit"
// list), proven against SQL: rows are added to the demo organization of this file's own
// freshly seeded database. today = 2026-09-03 (Thursday): org week 2026-08-31 … 2026-09-06,
// quarter start 2026-07-01.

let t: TestContext;
let admin: Awaited<ReturnType<TestContext['as']>>;
let org: string;

async function employee(firstName: string, lastName: string): Promise<string> {
  const [row] = await t.db.db
    .select({ id: schema.employees.id })
    .from(schema.employees)
    .where(and(eq(schema.employees.organizationId, org), eq(schema.employees.firstName, firstName), eq(schema.employees.lastName, lastName)));
  if (!row) throw new Error(`${firstName} ${lastName} missing`);
  return row.id;
}

async function onboardingCase(candidateName: string): Promise<string> {
  const [row] = await t.db.db
    .select({ id: schema.onboardingCases.id })
    .from(schema.onboardingCases)
    .where(and(eq(schema.onboardingCases.organizationId, org), eq(schema.onboardingCases.candidateName, candidateName)));
  if (!row) throw new Error(`${candidateName} missing`);
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

describe('onboarding summary rules', () => {
  it('applies the org week and the quarter at their edges and ignores received requests', async () => {
    const owner = await employee('Rosa', 'Medina');
    const base = { organizationId: org, role: 'company_driver' as const, ownerEmployeeId: owner, progressPercent: 10, nextStep: 'Rule check' };
    await t.db.db.insert(schema.onboardingCases).values([
      { ...base, candidateName: 'Sun Day', stage: 'application', startedOn: '2026-09-06', position: 11 },
      { ...base, candidateName: 'Next Monday', stage: 'application', startedOn: '2026-09-07', position: 12 },
      { ...base, candidateName: 'Last Sunday', stage: 'application', startedOn: '2026-08-30', position: 13 },
      { ...base, candidateName: 'Quarter Start', stage: 'complete', startedOn: '2026-06-01', completedOn: '2026-07-01', progressPercent: 100, position: 14 },
      { ...base, candidateName: 'Last Quarter', stage: 'complete', startedOn: '2026-06-01', completedOn: '2026-06-30', progressPercent: 100, position: 15 },
    ]);
    // A received request never makes a case "awaiting", nor becomes its first label.
    const request = { organizationId: org, status: 'received' as const };
    await t.db.db.insert(schema.onboardingDocumentRequests).values([
      { ...request, onboardingCaseId: await onboardingCase('Derek Holt'), label: 'Already in', position: 0 },
      { ...request, onboardingCaseId: await onboardingCase('Sofia Nguyen'), label: 'Road test form', position: 1 },
    ]);

    const { data, meta } = await get<OnboardingCaseRow[], OnboardingCasesMeta>('/hr/onboarding?limit=500');
    expect(data.map((c) => c.candidateName)).toEqual([
      'Jamal Reed',
      'Sofia Nguyen',
      'Derek Holt',
      'Kevin Brandt',
      'Maya Patel',
      'Evan Brooks',
      'Sun Day',
      'Next Monday',
      'Last Sunday',
      'Quarter Start',
      'Last Quarter',
    ]);
    expect(data.find((c) => c.candidateName === 'Derek Holt')?.pendingDocumentLabels).toEqual(['MVR consent', 'insurance certificate']);
    expect(data.find((c) => c.candidateName === 'Sofia Nguyen')?.pendingDocumentLabels).toEqual([]);
    expect(meta.summary).toMatchObject({
      caseCount: 11,
      inProgressCount: 8,
      startedThisWeekCount: 3,
      completedThisQuarterCount: 2,
      awaitingDocuments: [
        { candidateName: 'Derek Holt', firstPendingLabel: 'MVR consent' },
        { candidateName: 'Kevin Brandt', firstPendingLabel: 'medical card' },
      ],
    });
    expect(onboardingKpis(meta.summary)[2]).toEqual({ label: 'Awaiting documents', value: '2', note: 'MVR consent · medical card' });
  });
});

describe('contract summary rules', () => {
  it('orders renewals by renews_on, then list position', async () => {
    await t.db.db.insert(schema.employeeContracts).values({
      organizationId: org,
      employeeId: await employee('Luis', 'Ortega'),
      role: 'mechanic',
      contractType: 'form_1099',
      status: 'renewal_due',
      startsOn: '2025-09-20',
      renewsOn: '2026-09-20',
      payBasis: 'hourly',
      payRateCents: 4000,
      position: 11,
    });
    const { data, meta } = await get<EmployeeContractRow[], EmployeeContractsMeta>('/hr/contracts?limit=500');
    expect(data).toHaveLength(11);
    expect(data.at(-1)).toMatchObject({ employee: { fullName: 'Luis Ortega' }, contractType: 'form_1099', payRateCents: 4000 });
    expect(meta.summary.renewalsDue.map((r) => `${r.lastName} ${r.renewsOn}`)).toEqual(['Raman 2026-09-20', 'Ortega 2026-09-20', 'Nakamura 2026-10-01']);
    expect(meta.summary).toMatchObject({ contractCount: 11, activeCount: 6 });
  });
});
