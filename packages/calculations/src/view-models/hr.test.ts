import type { EmployeeContractRow, EmployeeContractsSummary, OnboardingCaseRow, OnboardingCasesSummary } from '@runtruck/types';
import { describe, expect, it } from 'vitest';
import {
  employeeContractKpis,
  formatOnboardingNextStep,
  onboardingKpis,
  toEmployeeContractRow,
  toOnboardingRow,
  type EmployeeContractRowVm,
  type OnboardingRowVm,
} from './hr.js';

// The seed as GET /hr/contracts and GET /hr/onboarding return it (docs/api/hr.md §2.5,
// §3.5), rendered through the builders and compared with Runtruck1's CONTRACTS and
// ONBOARDING (app/src/data/hr.ts) key for key, tagClass mapped to its chip tone.

const AS_OF = '2026-09-03';
const TAG_TONE = { 'tag-accent': 'blue', 'tag-neutral': 'gray', 'tag-outline': 'amber', 'tag-green': 'green' } as const;
type TagClass = keyof typeof TAG_TONE;

type ContractSeed = [string, EmployeeContractRow['role'], EmployeeContractRow['contractType'], EmployeeContractRow['status'], string, string, EmployeeContractRow['payBasis'], number | null, number | null];

const CONTRACT_SEED: ContractSeed[] = [
  ['Marcus Hale', 'company_driver', 'w2', 'active', '2022-03-14', '2027-03-14', 'per_mile', 62, null],
  ['Dara Whitfield', 'company_driver', 'w2', 'active', '2021-08-02', '2027-08-02', 'per_mile', 60, null],
  ['Ellis Nakamura', 'company_driver', 'w2', 'renewal_due', '2023-10-01', '2026-10-01', 'percent_of_line_haul', null, 2500],
  ['Priya Raman', 'company_driver', 'w2', 'renewal_due', '2024-09-20', '2026-09-20', 'per_mile', 58, null],
  ['Ana Cortez', 'company_driver', 'w2', 'active', '2026-01-12', '2027-01-12', 'per_mile', 58, null],
  ['Tobias Frey', 'owner_operator', 'lease_purchase', 'expiring', '2023-11-15', '2026-11-15', 'per_mile', 118, null],
  ['Rosa Medina', 'dispatcher', 'w2', 'active', '2020-06-06', '2027-06-06', 'annual_salary', 6_800_000, null],
  ['Luis Ortega', 'mechanic', 'w2', 'active', '2023-02-09', '2027-02-09', 'hourly', 3450, null],
  ['Evan Brooks', 'dispatcher', 'w2', 'active', '2026-07-27', '2027-07-27', 'annual_salary', 5_200_000, null],
  ['Jamal Reed', 'company_driver', 'w2', 'draft', '2026-09-08', '2027-09-08', 'per_mile', 56, null],
];

const contracts: EmployeeContractRow[] = CONTRACT_SEED.map(([fullName, role, contractType, status, startsOn, renewsOn, payBasis, payRateCents, payPercentBp], i) => ({
  id: `c${i}`,
  employee: { id: `e${i}`, fullName },
  role,
  contractType,
  status,
  startsOn,
  renewsOn,
  payBasis,
  payRateCents,
  payPercentBp,
}));

// Runtruck1 CONTRACTS, verbatim.
const RUNTRUCK1_CONTRACTS = [
  { employee: 'Marcus Hale', role: 'Company driver', type: 'W-2', start: 'Mar 14, 2022', renews: 'Mar 14, 2027', payBasis: '$0.62 / mi', status: 'Active', tagClass: 'tag-green' },
  { employee: 'Dara Whitfield', role: 'Company driver', type: 'W-2', start: 'Aug 2, 2021', renews: 'Aug 2, 2027', payBasis: '$0.60 / mi', status: 'Active', tagClass: 'tag-green' },
  { employee: 'Ellis Nakamura', role: 'Company driver', type: 'W-2', start: 'Oct 1, 2023', renews: 'Oct 1', payBasis: '25% of line haul', status: 'Renewal due', tagClass: 'tag-outline' },
  { employee: 'Priya Raman', role: 'Company driver', type: 'W-2', start: 'Sep 20, 2024', renews: 'Sep 20', payBasis: '$0.58 / mi', status: 'Renewal due', tagClass: 'tag-outline' },
  { employee: 'Ana Cortez', role: 'Company driver', type: 'W-2', start: 'Jan 12', renews: 'Jan 12, 2027', payBasis: '$0.58 / mi', status: 'Active', tagClass: 'tag-green' },
  { employee: 'Tobias Frey', role: 'Owner-operator', type: 'Lease-purchase', start: 'Nov 15, 2023', renews: 'Nov 15', payBasis: '$1.18 / mi', status: 'Expiring', tagClass: 'tag-outline' },
  { employee: 'Rosa Medina', role: 'Dispatcher', type: 'W-2', start: 'Jun 6, 2020', renews: 'Jun 6, 2027', payBasis: '$68,000 / yr', status: 'Active', tagClass: 'tag-green' },
  { employee: 'Luis Ortega', role: 'Mechanic', type: 'W-2', start: 'Feb 9, 2023', renews: 'Feb 9, 2027', payBasis: '$34.50 / hr', status: 'Active', tagClass: 'tag-green' },
  { employee: 'Evan Brooks', role: 'Dispatcher', type: 'W-2', start: 'Jul 27', renews: 'Jul 27, 2027', payBasis: '$52,000 / yr', status: 'Active', tagClass: 'tag-green' },
  { employee: 'Jamal Reed', role: 'Company driver', type: 'W-2', start: 'Sep 8', renews: 'Sep 8, 2027', payBasis: '$0.56 / mi', status: 'Draft', tagClass: 'tag-neutral' },
];

const ONBOARDING_SEED: [string, OnboardingCaseRow['role'], OnboardingCaseRow['stage'], string, string, number, string, string | null, string[]][] = [
  ['Jamal Reed', 'company_driver', 'orientation', '2026-08-17', 'Rosa Medina', 85, 'Ride-along with Ana Cortez', '2026-09-05', []],
  ['Sofia Nguyen', 'company_driver', 'road_test', '2026-08-24', 'Luis Ortega', 60, 'Road test in T-103', '2026-09-04', []],
  ['Derek Holt', 'owner_operator', 'background_check', '2026-08-28', 'Rosa Medina', 35, 'Waiting on MVR consent and insurance certificate', null, ['MVR consent', 'insurance certificate']],
  ['Kevin Brandt', 'company_driver', 'background_check', '2026-09-01', 'Rosa Medina', 30, 'Waiting on medical card copy', null, ['medical card']],
  ['Maya Patel', 'company_driver', 'application', '2026-09-02', 'Rosa Medina', 10, 'Phone screen', '2026-09-04', []],
  ['Evan Brooks', 'dispatcher', 'complete', '2026-07-13', 'Rosa Medina', 100, '90-day review', '2026-10-25', []],
];

const cases: OnboardingCaseRow[] = ONBOARDING_SEED.map(([candidateName, role, stage, startedOn, owner, progressPercent, nextStep, nextStepOn, pendingDocumentLabels], i) => ({
  id: `o${i}`,
  candidateName,
  employeeId: null,
  role,
  stage,
  startedOn,
  owner: { id: `w${i}`, fullName: owner },
  progressPercent,
  nextStep,
  nextStepOn,
  completedOn: stage === 'complete' ? '2026-07-27' : null,
  pendingDocumentLabels,
}));

// Runtruck1 ONBOARDING, verbatim.
const RUNTRUCK1_ONBOARDING = [
  { candidate: 'Jamal Reed', role: 'Company driver', stage: 'Orientation', started: 'Aug 17', owner: 'Rosa Medina', progress: 85, nextStep: 'Ride-along with Ana Cortez · Sep 5', docsPending: false, tagClass: 'tag-accent' },
  { candidate: 'Sofia Nguyen', role: 'Company driver', stage: 'Road test', started: 'Aug 24', owner: 'Luis Ortega', progress: 60, nextStep: 'Road test in T-103 · Sep 4', docsPending: false, tagClass: 'tag-accent' },
  { candidate: 'Derek Holt', role: 'Owner-operator', stage: 'Background check', started: 'Aug 28', owner: 'Rosa Medina', progress: 35, nextStep: 'Waiting on MVR consent and insurance certificate', docsPending: true, tagClass: 'tag-outline' },
  { candidate: 'Kevin Brandt', role: 'Company driver', stage: 'Background check', started: 'Sep 1', owner: 'Rosa Medina', progress: 30, nextStep: 'Waiting on medical card copy', docsPending: true, tagClass: 'tag-outline' },
  { candidate: 'Maya Patel', role: 'Company driver', stage: 'Application', started: 'Sep 2', owner: 'Rosa Medina', progress: 10, nextStep: 'Phone screen · Sep 4', docsPending: false, tagClass: 'tag-neutral' },
  { candidate: 'Evan Brooks', role: 'Dispatcher', stage: 'Complete', started: 'Jul 13', owner: 'Rosa Medina', progress: 100, nextStep: '90-day review · Oct 25', docsPending: false, tagClass: 'tag-green' },
];

// A view-model row with its ref replaced by Runtruck1's tagClass (the only presentation key).
function asRuntruck1<T extends { ref: { tone: string } }>(vm: T): Omit<T, 'ref'> & { tagClass: TagClass } {
  const { ref, ...row } = vm;
  const tagClass = (Object.keys(TAG_TONE) as TagClass[]).find((k) => TAG_TONE[k] === ref.tone);
  if (!tagClass) throw new Error(`no tagClass for ${ref.tone}`);
  return { ...row, tagClass };
}

describe('toEmployeeContractRow', () => {
  it('reproduces every Runtruck1 CONTRACTS row, key for key', () => {
    const rows: EmployeeContractRowVm[] = contracts.map((c) => toEmployeeContractRow(c, AS_OF));
    expect(rows.map(asRuntruck1)).toEqual(RUNTRUCK1_CONTRACTS);
    expect(Object.keys(rows[0] ?? {})).toEqual(['employee', 'role', 'type', 'start', 'renews', 'payBasis', 'status', 'ref']);
    expect(rows[0]?.ref).toEqual({ id: 'c0', tone: 'green' });
  });

  it('labels a 1099 contract', () => {
    const row = toEmployeeContractRow({ ...contracts[0]!, contractType: 'form_1099' }, AS_OF);
    expect(row.type).toBe('1099');
  });
});

describe('employeeContractKpis', () => {
  const entry = (i: number) => {
    const c = contracts[i]!;
    return {
      contractId: c.id,
      employeeId: c.employee.id,
      fullName: c.employee.fullName,
      lastName: c.employee.fullName.split(' ')[1] ?? '',
      contractType: c.contractType,
      startsOn: c.startsOn,
      renewsOn: c.renewsOn,
    };
  };
  const summary: EmployeeContractsSummary = {
    asOf: AS_OF,
    contractCount: 10,
    activeCount: 6,
    renewalsDue: [entry(3), entry(2)],
    ownerOperators: [entry(5)],
    drafts: [entry(9)],
  };

  it('reproduces Runtruck1 KPIs, including the hard-coded notes (hr.md §4.1)', () => {
    expect(employeeContractKpis(summary)).toEqual([
      { label: 'Active contracts', value: '6', note: '10 on file' },
      { label: 'Renewals due (30 d)', value: '2', note: 'Raman Sep 20 · Nakamura Oct 1' },
      { label: 'Owner-operators', value: '1', note: 'Frey · lease-purchase ends Nov 15' },
      { label: 'Drafts', value: '1', note: 'Reed · starts Sep 8' },
    ]);
  });

  it('reads "None" for empty lists and "—" without notes while pending', () => {
    expect(employeeContractKpis({ ...summary, contractCount: 0, activeCount: 0, renewalsDue: [], ownerOperators: [], drafts: [] })).toEqual([
      { label: 'Active contracts', value: '0', note: '0 on file' },
      { label: 'Renewals due (30 d)', value: '0', note: 'None' },
      { label: 'Owner-operators', value: '0', note: 'None' },
      { label: 'Drafts', value: '0', note: 'None' },
    ]);
    expect(employeeContractKpis(undefined)).toEqual([
      { label: 'Active contracts', value: '—' },
      { label: 'Renewals due (30 d)', value: '—' },
      { label: 'Owner-operators', value: '—' },
      { label: 'Drafts', value: '—' },
    ]);
  });
});

describe('toOnboardingRow', () => {
  it('reproduces every Runtruck1 ONBOARDING row, key for key', () => {
    const rows: OnboardingRowVm[] = cases.map(toOnboardingRow);
    expect(rows.map(asRuntruck1)).toEqual(RUNTRUCK1_ONBOARDING);
    expect(Object.keys(rows[0] ?? {})).toEqual(['candidate', 'role', 'stage', 'started', 'owner', 'progress', 'nextStep', 'docsPending', 'ref']);
  });

  it('appends the next-step date only when set', () => {
    expect(formatOnboardingNextStep('Phone screen', '2026-09-04')).toBe('Phone screen · Sep 4');
    expect(formatOnboardingNextStep('Phone screen', null)).toBe('Phone screen');
  });
});

describe('onboardingKpis', () => {
  const summary: OnboardingCasesSummary = {
    asOf: AS_OF,
    weekStart: '2026-08-31',
    weekEnd: '2026-09-06',
    quarterStart: '2026-07-01',
    caseCount: 6,
    inProgressCount: 5,
    inOrientationCount: 1,
    startedThisWeekCount: 2,
    awaitingDocuments: [
      { caseId: 'o2', candidateName: 'Derek Holt', firstPendingLabel: 'MVR consent' },
      { caseId: 'o3', candidateName: 'Kevin Brandt', firstPendingLabel: 'medical card' },
    ],
    completedThisQuarterCount: 1,
  };

  it('reproduces Runtruck1 KPIs, including the hard-coded notes (hr.md §4.2)', () => {
    expect(onboardingKpis(summary)).toEqual([
      { label: 'In progress', value: '5', note: '1 in orientation' },
      { label: 'Starting this week', value: '2', note: 'Opened since Mon Aug 31' },
      { label: 'Awaiting documents', value: '2', note: 'MVR consent · medical card' },
      { label: 'Completed this quarter', value: '1', note: 'Since Jul 1' },
    ]);
  });

  it('reads "None" without awaiting cases and "—" while pending', () => {
    expect(onboardingKpis({ ...summary, awaitingDocuments: [] })[2]).toEqual({ label: 'Awaiting documents', value: '0', note: 'None' });
    expect(onboardingKpis(undefined).map((k) => [k.value, k.note])).toEqual([
      ['—', undefined],
      ['—', undefined],
      ['—', undefined],
      ['—', undefined],
    ]);
  });
});
