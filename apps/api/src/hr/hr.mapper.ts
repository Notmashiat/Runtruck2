import type {
  EmployeeContractKpiEntry,
  EmployeeContractRow,
  EmployeeContractsSummary,
  OnboardingCaseRow,
  OnboardingCasesSummary,
} from '@runtruck/types';
import type { ContractSqlRow, OnboardingSqlRow } from './hr.repository.js';

// Pure mapping and aggregation for GET /hr/contracts and GET /hr/onboarding
// (docs/api/hr.md §2–§3, docs/03-database.md §6.8).

// A contract row plus the facts its KPI entries need but the row does not carry.
export interface ContractRecord {
  row: EmployeeContractRow;
  lastName: string;
}

export function toContractRecord(r: ContractSqlRow): ContractRecord {
  return {
    lastName: r.last_name,
    row: {
      id: r.id,
      employee: { id: r.employee_id, fullName: `${r.first_name} ${r.last_name}` },
      role: r.role,
      contractType: r.contract_type,
      status: r.status,
      startsOn: r.starts_on,
      renewsOn: r.renews_on,
      payBasis: r.pay_basis,
      payRateCents: r.pay_rate_cents,
      payPercentBp: r.pay_percent_bp,
    },
  };
}

function kpiEntry({ row, lastName }: ContractRecord): EmployeeContractKpiEntry {
  return {
    contractId: row.id,
    employeeId: row.employee.id,
    fullName: row.employee.fullName,
    lastName,
    contractType: row.contractType,
    startsOn: row.startsOn,
    renewsOn: row.renewsOn,
  };
}

// KPI figures over every contract of the organization, in list order (never filtered by q
// or status). Renewals are ordered by renewsOn; the sort is stable, so ties keep the list
// order (position, id), as hr.md §2.4 requires.
export function summarizeContracts(records: readonly ContractRecord[], asOf: string): EmployeeContractsSummary {
  const renewalsDue = records
    .filter((r) => r.row.status === 'renewal_due')
    .map(kpiEntry)
    .sort((a, b) => (a.renewsOn < b.renewsOn ? -1 : a.renewsOn > b.renewsOn ? 1 : 0));
  return {
    asOf,
    contractCount: records.length,
    activeCount: records.filter((r) => r.row.status === 'active').length,
    renewalsDue,
    ownerOperators: records.filter((r) => r.row.role === 'owner_operator').map(kpiEntry),
    drafts: records.filter((r) => r.row.status === 'draft').map(kpiEntry),
  };
}

export function toOnboardingCase(r: OnboardingSqlRow): OnboardingCaseRow {
  return {
    id: r.id,
    candidateName: r.candidate_name,
    employeeId: r.employee_id,
    role: r.role,
    stage: r.stage,
    startedOn: r.started_on,
    owner: { id: r.owner_id, fullName: `${r.owner_first_name} ${r.owner_last_name}` },
    progressPercent: r.progress_percent,
    nextStep: r.next_step,
    nextStepOn: r.next_step_on,
    completedOn: r.completed_on,
    pendingDocumentLabels: r.pending_labels,
  };
}

export type OnboardingWindows = Pick<OnboardingCasesSummary, 'asOf' | 'weekStart' | 'weekEnd' | 'quarterStart'>;

// KPI figures over every onboarding case of the organization, in list order (never
// filtered by q or stage). Dates compare as YYYY-MM-DD strings.
export function summarizeOnboarding(cases: readonly OnboardingCaseRow[], windows: OnboardingWindows): OnboardingCasesSummary {
  return {
    ...windows,
    caseCount: cases.length,
    inProgressCount: cases.filter((c) => c.stage !== 'complete').length,
    inOrientationCount: cases.filter((c) => c.stage === 'orientation').length,
    startedThisWeekCount: cases.filter((c) => c.startedOn >= windows.weekStart && c.startedOn <= windows.weekEnd).length,
    awaitingDocuments: cases.flatMap((c) => {
      const [firstPendingLabel] = c.pendingDocumentLabels;
      return firstPendingLabel === undefined ? [] : [{ caseId: c.id, candidateName: c.candidateName, firstPendingLabel }];
    }),
    completedThisQuarterCount: cases.filter((c) => c.stage === 'complete' && c.completedOn !== null && c.completedOn >= windows.quarterStart)
      .length,
  };
}
