import type { DbExecutor } from '../../client.js';
import { employeeContracts, employees, onboardingCases, onboardingDocumentRequests } from '../../schema/hr.js';
import { day, must, remember, type DemoRefs } from './refs.js';

// Workforce (§7.6–§7.8): employees, Runtruck1 CONTRACTS and ONBOARDING.

type EmployeeStatus = (typeof employees.$inferInsert)['status'];
type Contract = typeof employeeContracts.$inferInsert;
type Onboarding = typeof onboardingCases.$inferInsert;

interface EmployeeSeed {
  firstName: string;
  lastName: string;
  status: EmployeeStatus;
  // Rosa Medina is linked to her user (§7.6).
  isAdminUser?: boolean;
}

export const DEMO_EMPLOYEES: readonly EmployeeSeed[] = [
  { firstName: 'Marcus', lastName: 'Hale', status: 'active' },
  { firstName: 'Dara', lastName: 'Whitfield', status: 'active' },
  { firstName: 'Ellis', lastName: 'Nakamura', status: 'active' },
  { firstName: 'Priya', lastName: 'Raman', status: 'active' },
  { firstName: 'Ana', lastName: 'Cortez', status: 'active' },
  { firstName: 'Tobias', lastName: 'Frey', status: 'active' },
  { firstName: 'Rosa', lastName: 'Medina', status: 'active', isAdminUser: true },
  { firstName: 'Luis', lastName: 'Ortega', status: 'active' },
  { firstName: 'Evan', lastName: 'Brooks', status: 'active' },
  { firstName: 'Jamal', lastName: 'Reed', status: 'onboarding' },
];

type ContractSeed = Pick<Contract, 'role' | 'contractType' | 'status' | 'startsOn' | 'renewsOn' | 'payBasis'> & {
  employee: string;
  payRateCents?: number;
  payPercentBp?: number;
};

// In position order (§7.7).
export const DEMO_CONTRACTS: readonly ContractSeed[] = [
  { employee: 'Marcus Hale', role: 'company_driver', contractType: 'w2', status: 'active', startsOn: '2022-03-14', renewsOn: '2027-03-14', payBasis: 'per_mile', payRateCents: 62 },
  { employee: 'Dara Whitfield', role: 'company_driver', contractType: 'w2', status: 'active', startsOn: '2021-08-02', renewsOn: '2027-08-02', payBasis: 'per_mile', payRateCents: 60 },
  { employee: 'Ellis Nakamura', role: 'company_driver', contractType: 'w2', status: 'renewal_due', startsOn: '2023-10-01', renewsOn: '2026-10-01', payBasis: 'percent_of_line_haul', payPercentBp: 2500 },
  { employee: 'Priya Raman', role: 'company_driver', contractType: 'w2', status: 'renewal_due', startsOn: '2024-09-20', renewsOn: '2026-09-20', payBasis: 'per_mile', payRateCents: 58 },
  { employee: 'Ana Cortez', role: 'company_driver', contractType: 'w2', status: 'active', startsOn: '2026-01-12', renewsOn: '2027-01-12', payBasis: 'per_mile', payRateCents: 58 },
  { employee: 'Tobias Frey', role: 'owner_operator', contractType: 'lease_purchase', status: 'expiring', startsOn: '2023-11-15', renewsOn: '2026-11-15', payBasis: 'per_mile', payRateCents: 118 },
  { employee: 'Rosa Medina', role: 'dispatcher', contractType: 'w2', status: 'active', startsOn: '2020-06-06', renewsOn: '2027-06-06', payBasis: 'annual_salary', payRateCents: 6_800_000 },
  { employee: 'Luis Ortega', role: 'mechanic', contractType: 'w2', status: 'active', startsOn: '2023-02-09', renewsOn: '2027-02-09', payBasis: 'hourly', payRateCents: 3450 },
  { employee: 'Evan Brooks', role: 'dispatcher', contractType: 'w2', status: 'active', startsOn: '2026-07-27', renewsOn: '2027-07-27', payBasis: 'annual_salary', payRateCents: 5_200_000 },
  { employee: 'Jamal Reed', role: 'company_driver', contractType: 'w2', status: 'draft', startsOn: '2026-09-08', renewsOn: '2027-09-08', payBasis: 'per_mile', payRateCents: 56 },
];

type OnboardingSeed = Pick<Onboarding, 'candidateName' | 'role' | 'stage' | 'progressPercent' | 'nextStep'> & {
  employee?: string;
  startedOn: string;
  owner: string;
  nextStepOn?: string;
  completedOn?: string;
  // Runtruck1 docsPending, split into the documents its nextStep names (§7.8).
  pendingDocuments?: readonly string[];
};

// In position order (§7.8).
export const DEMO_ONBOARDING: readonly OnboardingSeed[] = [
  { candidateName: 'Jamal Reed', employee: 'Jamal Reed', role: 'company_driver', stage: 'orientation', startedOn: day('08-17'), owner: 'Rosa Medina', progressPercent: 85, nextStep: 'Ride-along with Ana Cortez', nextStepOn: day('09-05') },
  { candidateName: 'Sofia Nguyen', role: 'company_driver', stage: 'road_test', startedOn: day('08-24'), owner: 'Luis Ortega', progressPercent: 60, nextStep: 'Road test in T-103', nextStepOn: day('09-04') },
  {
    candidateName: 'Derek Holt',
    role: 'owner_operator',
    stage: 'background_check',
    startedOn: day('08-28'),
    owner: 'Rosa Medina',
    progressPercent: 35,
    nextStep: 'Waiting on MVR consent and insurance certificate',
    pendingDocuments: ['MVR consent', 'insurance certificate'],
  },
  { candidateName: 'Kevin Brandt', role: 'company_driver', stage: 'background_check', startedOn: day('09-01'), owner: 'Rosa Medina', progressPercent: 30, nextStep: 'Waiting on medical card copy', pendingDocuments: ['medical card'] },
  { candidateName: 'Maya Patel', role: 'company_driver', stage: 'application', startedOn: day('09-02'), owner: 'Rosa Medina', progressPercent: 10, nextStep: 'Phone screen', nextStepOn: day('09-04') },
  // completed_on = his contract start (C4: Runtruck1 gives no completion date).
  { candidateName: 'Evan Brooks', employee: 'Evan Brooks', role: 'dispatcher', stage: 'complete', startedOn: day('07-13'), owner: 'Rosa Medina', progressPercent: 100, nextStep: '90-day review', nextStepOn: day('10-25'), completedOn: day('07-27') },
];

export async function seedEmployees(db: DbExecutor, refs: DemoRefs): Promise<void> {
  const { organizationId, adminUserId } = refs;
  const inserted = await db
    .insert(employees)
    .values(
      DEMO_EMPLOYEES.map((e) => ({
        organizationId,
        firstName: e.firstName,
        lastName: e.lastName,
        status: e.status,
        userId: e.isAdminUser ? adminUserId : null,
      })),
    )
    .returning({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName });
  remember(
    refs.employees,
    inserted.map((e) => ({ key: `${e.firstName} ${e.lastName}`, id: e.id })),
  );
}

export async function seedHr(db: DbExecutor, refs: DemoRefs): Promise<void> {
  const { organizationId } = refs;
  const employee = (name: string) => must(refs.employees, name, 'employee');

  await db.insert(employeeContracts).values(
    DEMO_CONTRACTS.map((c, i) => ({
      organizationId,
      employeeId: employee(c.employee),
      role: c.role,
      contractType: c.contractType,
      status: c.status,
      startsOn: c.startsOn,
      renewsOn: c.renewsOn,
      payBasis: c.payBasis,
      payRateCents: c.payRateCents ?? null,
      payPercentBp: c.payPercentBp ?? null,
      position: i + 1,
    })),
  );

  const cases = await db
    .insert(onboardingCases)
    .values(
      DEMO_ONBOARDING.map((o, i) => ({
        organizationId,
        candidateName: o.candidateName,
        employeeId: o.employee ? employee(o.employee) : null,
        role: o.role,
        stage: o.stage,
        startedOn: o.startedOn,
        ownerEmployeeId: employee(o.owner),
        progressPercent: o.progressPercent,
        nextStep: o.nextStep,
        nextStepOn: o.nextStepOn ?? null,
        completedOn: o.completedOn ?? null,
        position: i + 1,
      })),
    )
    .returning({ key: onboardingCases.candidateName, id: onboardingCases.id });
  const caseIds = new Map<string, string>();
  remember(caseIds, cases);

  const requests = DEMO_ONBOARDING.flatMap((o) =>
    (o.pendingDocuments ?? []).map((label, i) => ({
      organizationId,
      onboardingCaseId: must(caseIds, o.candidateName, 'onboarding case'),
      label,
      status: 'pending' as const,
      position: i + 1,
    })),
  );
  await db.insert(onboardingDocumentRequests).values(requests);
}
