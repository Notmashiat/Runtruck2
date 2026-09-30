// hr view-model builders and label/tone maps: turn API DTOs into Runtruck1-shaped
// display rows. Shared by the web (rendering + live search) and the API (server-side q)
// so both match identically (docs/03-database.md §1.11). Specified in docs/api/hr.md §4.
//
// Row convention (hr.md §4): every table row has exactly the Runtruck1 mock row's keys
// (minus tagClass) with the same display strings and raw numbers, plus `ref`, an object
// that matchesQuery never searches (ids, enum values and tones can therefore never match).

import type {
  EmployeeContractRow,
  EmployeeContractsSummary,
  EmployeeContractStatus,
  EmployeeContractType,
  EmployeeRole,
  OnboardingCaseRow,
  OnboardingCasesSummary,
  OnboardingStage,
} from '@runtruck/types';
import { EM_DASH, formatDate, formatPayBasis, formatShortDate } from '../format.js';

// Chip tones of @runtruck/ui's Tag (presentation only).
type Tone = 'blue' | 'gray' | 'amber' | 'green';

// One KPI card (@runtruck/ui Kpi without onClick). While the data is pending or refused
// the value is "—" and there is no note (implementation-brief §4).
interface KpiVm {
  label: string;
  value: string;
  note?: string;
}

const PENDING = EM_DASH;

// ---------------------------------------------------------------------------
// Label and tone maps (hr.md §4; docs/03-database.md §5.4.2–§5.4.3)

export const EMPLOYEE_ROLE_LABEL: Record<EmployeeRole, string> = {
  company_driver: 'Company driver',
  owner_operator: 'Owner-operator',
  dispatcher: 'Dispatcher',
  mechanic: 'Mechanic',
};

export const CONTRACT_TYPE_LABEL: Record<EmployeeContractType, string> = { w2: 'W-2', form_1099: '1099', lease_purchase: 'Lease-purchase' };

export const CONTRACT_STATUS_LABEL: Record<EmployeeContractStatus, string> = {
  active: 'Active',
  renewal_due: 'Renewal due',
  expiring: 'Expiring',
  draft: 'Draft',
};
export const CONTRACT_STATUS_TONE: Record<EmployeeContractStatus, Tone> = { active: 'green', renewal_due: 'amber', expiring: 'amber', draft: 'gray' };

export const ONBOARDING_STAGE_LABEL: Record<OnboardingStage, string> = {
  application: 'Application',
  background_check: 'Background check',
  road_test: 'Road test',
  orientation: 'Orientation',
  complete: 'Complete',
};
export const ONBOARDING_STAGE_TONE: Record<OnboardingStage, Tone> = {
  application: 'gray',
  background_check: 'amber',
  road_test: 'blue',
  orientation: 'blue',
  complete: 'green',
};

// ---------------------------------------------------------------------------
// HR › Employee Contracts (hr.md §4.1)

/** Runtruck1 `Contract` row. */
export interface EmployeeContractRowVm {
  employee: string;
  role: string;
  type: string;
  start: string;
  renews: string;
  payBasis: string;
  status: string;
  ref: { id: string; tone: Tone };
}

// `asOf` is meta.summary.asOf: F-DATE drops the year for dates in the org's current year.
export function toEmployeeContractRow(c: EmployeeContractRow, asOf: string): EmployeeContractRowVm {
  return {
    employee: c.employee.fullName,
    role: EMPLOYEE_ROLE_LABEL[c.role],
    type: CONTRACT_TYPE_LABEL[c.contractType],
    start: formatDate(c.startsOn, asOf),
    renews: formatDate(c.renewsOn, asOf),
    payBasis: formatPayBasis(c.payBasis, c.payRateCents, c.payPercentBp),
    status: CONTRACT_STATUS_LABEL[c.status],
    ref: { id: c.id, tone: CONTRACT_STATUS_TONE[c.status] },
  };
}

// The KPI row. Runtruck1 hard-coded the last three notes; they are composed here from the
// summary lists (decision H3), "None" for an empty list.
export function employeeContractKpis(summary: EmployeeContractsSummary | undefined): KpiVm[] {
  if (!summary) {
    return ['Active contracts', 'Renewals due (30 d)', 'Owner-operators', 'Drafts'].map((label) => ({ label, value: PENDING }));
  }
  const { asOf, renewalsDue, ownerOperators, drafts } = summary;
  return [
    { label: 'Active contracts', value: String(summary.activeCount), note: `${summary.contractCount} on file` },
    {
      label: 'Renewals due (30 d)',
      value: String(renewalsDue.length),
      note: renewalsDue.map((c) => `${c.lastName} ${formatDate(c.renewsOn, asOf)}`).join(' · ') || 'None',
    },
    {
      label: 'Owner-operators',
      value: String(ownerOperators.length),
      note:
        ownerOperators
          .map((c) => `${c.lastName} · ${CONTRACT_TYPE_LABEL[c.contractType].toLowerCase()} ends ${formatDate(c.renewsOn, asOf)}`)
          .join(', ') || 'None',
    },
    {
      label: 'Drafts',
      value: String(drafts.length),
      note: drafts.map((c) => `${c.lastName} · starts ${formatDate(c.startsOn, asOf)}`).join(', ') || 'None',
    },
  ];
}

// ---------------------------------------------------------------------------
// HR › Onboarding (hr.md §4.2)

/** Runtruck1 `Onboarding` row. `progress` stays a raw number (searched as its digits);
 * `docsPending` is a boolean, which matchesQuery never searches (as in Runtruck1). */
export interface OnboardingRowVm {
  candidate: string;
  role: string;
  stage: string;
  started: string;
  owner: string;
  progress: number;
  nextStep: string;
  docsPending: boolean;
  ref: { id: string; tone: Tone };
}

// "Ride-along with Ana Cortez · Sep 5"; the bare step when it has no date (03 §6.0.8).
export function formatOnboardingNextStep(nextStep: string, nextStepOn: string | null): string {
  return nextStepOn === null ? nextStep : `${nextStep} · ${formatShortDate(nextStepOn)}`;
}

export function toOnboardingRow(o: OnboardingCaseRow): OnboardingRowVm {
  return {
    candidate: o.candidateName,
    role: EMPLOYEE_ROLE_LABEL[o.role],
    stage: ONBOARDING_STAGE_LABEL[o.stage],
    started: formatShortDate(o.startedOn),
    owner: o.owner.fullName,
    progress: o.progressPercent,
    nextStep: formatOnboardingNextStep(o.nextStep, o.nextStepOn),
    docsPending: o.pendingDocumentLabels.length > 0,
    ref: { id: o.id, tone: ONBOARDING_STAGE_TONE[o.stage] },
  };
}

export function onboardingKpis(summary: OnboardingCasesSummary | undefined): KpiVm[] {
  if (!summary) {
    return ['In progress', 'Starting this week', 'Awaiting documents', 'Completed this quarter'].map((label) => ({ label, value: PENDING }));
  }
  return [
    { label: 'In progress', value: String(summary.inProgressCount), note: `${summary.inOrientationCount} in orientation` },
    // The org week always starts on a Monday (hr.md §1.1).
    { label: 'Starting this week', value: String(summary.startedThisWeekCount), note: `Opened since Mon ${formatShortDate(summary.weekStart)}` },
    {
      label: 'Awaiting documents',
      value: String(summary.awaitingDocuments.length),
      note: summary.awaitingDocuments.map((a) => a.firstPendingLabel).join(' · ') || 'None',
    },
    { label: 'Completed this quarter', value: String(summary.completedThisQuarterCount), note: `Since ${formatShortDate(summary.quarterStart)}` },
  ];
}
