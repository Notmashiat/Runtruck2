import type { OnboardingCaseRow } from '@runtruck/types';
import { describe, expect, it } from 'vitest';
import type { ContractSqlRow, OnboardingSqlRow } from './hr.repository.js';
import { summarizeContracts, summarizeOnboarding, toContractRecord, toOnboardingCase } from './hr.mapper.js';

// docs/api/hr.md §6 unit tests: org-week and quarter boundaries, renewals order,
// first pending label, and the row mapping.

const contractRow = (over: Partial<ContractSqlRow>): ContractSqlRow => ({
  id: 'c',
  role: 'company_driver',
  contract_type: 'w2',
  status: 'active',
  starts_on: '2024-01-01',
  renews_on: '2027-01-01',
  pay_basis: 'per_mile',
  pay_rate_cents: 60,
  pay_percent_bp: null,
  employee_id: 'e',
  first_name: 'Pat',
  last_name: 'Doe',
  ...over,
});

describe('toContractRecord', () => {
  it('maps the row and keeps the last name for the KPI notes', () => {
    expect(toContractRecord(contractRow({ pay_basis: 'percent_of_line_haul', pay_rate_cents: null, pay_percent_bp: 2500 }))).toEqual({
      lastName: 'Doe',
      row: {
        id: 'c',
        employee: { id: 'e', fullName: 'Pat Doe' },
        role: 'company_driver',
        contractType: 'w2',
        status: 'active',
        startsOn: '2024-01-01',
        renewsOn: '2027-01-01',
        payBasis: 'percent_of_line_haul',
        payRateCents: null,
        payPercentBp: 2500,
      },
    });
  });
});

describe('summarizeContracts', () => {
  const records = [
    contractRow({ id: 'a', last_name: 'Nakamura', status: 'renewal_due', renews_on: '2026-10-01' }),
    contractRow({ id: 'b', last_name: 'Raman', status: 'renewal_due', renews_on: '2026-09-20' }),
    contractRow({ id: 'c', last_name: 'Frey', role: 'owner_operator', contract_type: 'lease_purchase', status: 'expiring' }),
    contractRow({ id: 'd', last_name: 'Early', status: 'renewal_due', renews_on: '2026-09-20' }),
    contractRow({ id: 'e', last_name: 'Reed', status: 'draft' }),
    contractRow({ id: 'f', last_name: 'Hale' }),
  ].map(toContractRecord);

  it('counts and lists over every contract; renewals by renewsOn, ties in list order', () => {
    const s = summarizeContracts(records, '2026-09-03');
    expect(s).toMatchObject({ asOf: '2026-09-03', contractCount: 6, activeCount: 1 });
    expect(s.renewalsDue.map((r) => [r.lastName, r.renewsOn])).toEqual([
      ['Raman', '2026-09-20'],
      ['Early', '2026-09-20'],
      ['Nakamura', '2026-10-01'],
    ]);
    expect(s.ownerOperators).toEqual([
      { contractId: 'c', employeeId: 'e', fullName: 'Pat Frey', lastName: 'Frey', contractType: 'lease_purchase', startsOn: '2024-01-01', renewsOn: '2027-01-01' },
    ]);
    expect(s.drafts.map((d) => d.lastName)).toEqual(['Reed']);
  });

  it('is all zero for an organization without contracts', () => {
    expect(summarizeContracts([], '2026-09-03')).toEqual({
      asOf: '2026-09-03',
      contractCount: 0,
      activeCount: 0,
      renewalsDue: [],
      ownerOperators: [],
      drafts: [],
    });
  });
});

const onboardingRow = (over: Partial<OnboardingSqlRow>): OnboardingSqlRow => ({
  id: 'o',
  candidate_name: 'Sam Lee',
  employee_id: null,
  role: 'company_driver',
  stage: 'application',
  started_on: '2026-08-01',
  progress_percent: 10,
  next_step: 'Phone screen',
  next_step_on: null,
  completed_on: null,
  owner_id: 'w',
  owner_first_name: 'Rosa',
  owner_last_name: 'Medina',
  pending_labels: [],
  ...over,
});

describe('toOnboardingCase', () => {
  it('maps the row, the owner and the pending labels', () => {
    expect(toOnboardingCase(onboardingRow({ pending_labels: ['MVR consent'], next_step_on: '2026-09-04' }))).toEqual({
      id: 'o',
      candidateName: 'Sam Lee',
      employeeId: null,
      role: 'company_driver',
      stage: 'application',
      startedOn: '2026-08-01',
      owner: { id: 'w', fullName: 'Rosa Medina' },
      progressPercent: 10,
      nextStep: 'Phone screen',
      nextStepOn: '2026-09-04',
      completedOn: null,
      pendingDocumentLabels: ['MVR consent'],
    });
  });
});

describe('summarizeOnboarding', () => {
  const windows = { asOf: '2026-09-03', weekStart: '2026-08-31', weekEnd: '2026-09-06', quarterStart: '2026-07-01' };
  const c = (over: Partial<OnboardingSqlRow>): OnboardingCaseRow => toOnboardingCase(onboardingRow(over));

  it('counts a case started on the Monday or the Sunday of the org week, not the days outside it', () => {
    const cases = ['2026-08-30', '2026-08-31', '2026-09-06', '2026-09-07'].map((startedOn, i) => c({ id: `o${i}`, started_on: startedOn }));
    expect(summarizeOnboarding(cases, windows).startedThisWeekCount).toBe(2);
  });

  it('counts a case completed on the quarter start, not the day before', () => {
    const cases = [
      c({ id: 'a', stage: 'complete', completed_on: '2026-07-01' }),
      c({ id: 'b', stage: 'complete', completed_on: '2026-06-30' }),
      c({ id: 'c', stage: 'orientation' }),
    ];
    expect(summarizeOnboarding(cases, windows)).toMatchObject({ caseCount: 3, inProgressCount: 1, inOrientationCount: 1, completedThisQuarterCount: 1 });
  });

  it('lists cases awaiting documents in list order with their first pending label', () => {
    const cases = [
      c({ id: 'a', candidate_name: 'Derek Holt', pending_labels: ['MVR consent', 'insurance certificate'] }),
      c({ id: 'b', candidate_name: 'Nobody Pending' }),
      c({ id: 'c', candidate_name: 'Kevin Brandt', pending_labels: ['medical card'] }),
    ];
    expect(summarizeOnboarding(cases, windows).awaitingDocuments).toEqual([
      { caseId: 'a', candidateName: 'Derek Holt', firstPendingLabel: 'MVR consent' },
      { caseId: 'c', candidateName: 'Kevin Brandt', firstPendingLabel: 'medical card' },
    ]);
  });
});
