// HR wire types — specified in docs/api/hr.md.
// Endpoints: GET /hr/contracts, GET /hr/onboarding (permission hr.view).
// Money is integer cents, rates are cents or basis points, business dates are YYYY-MM-DD.
// Labels, chip tones and every display string are web presentation (docs/api/hr.md §4).

import type { ApiSuccess, PageMeta } from './api.js';

// docs/03-database.md §4.3. Runtruck1 labels: Company driver / Owner-operator / Dispatcher / Mechanic.
export type EmployeeRole = 'company_driver' | 'owner_operator' | 'dispatcher' | 'mechanic';

// Runtruck1 labels: W-2 / 1099 / Lease-purchase.
export type EmployeeContractType = 'w2' | 'form_1099' | 'lease_purchase';

// Stored lifecycle status (design brief §2). Runtruck1 labels: Active / Renewal due / Expiring / Draft.
export type EmployeeContractStatus = 'active' | 'renewal_due' | 'expiring' | 'draft';

// `pay_basis` (docs/03-database.md §4.3), the canonical wire union; settlements.ts aliases it.
// Display, 03 §6.0.6: "$0.62 / mi", "25% of line haul", "$68,000 / yr", "$34.50 / hr".
export type EmployeeContractPayBasis = 'per_mile' | 'percent_of_line_haul' | 'annual_salary' | 'hourly';

// Runtruck1 labels: Application / Background check / Road test / Orientation / Complete.
export type OnboardingStage = 'application' | 'background_check' | 'road_test' | 'orientation' | 'complete';

// An employee as a list shows them: first_name + " " + last_name.
export interface HrEmployeeRef {
  id: string;
  fullName: string;
}

// ─── GET /hr/contracts ───────────────────────────────────────────────────

export interface EmployeeContractRow {
  id: string;
  employee: HrEmployeeRef;
  role: EmployeeRole;
  contractType: EmployeeContractType;
  status: EmployeeContractStatus;
  startsOn: string;
  // The renewal date, or the end of a fixed term (status expiring).
  renewsOn: string;
  payBasis: EmployeeContractPayBasis;
  // Cents per mile / per hour / per year; null for percent_of_line_haul.
  payRateCents: number | null;
  // Basis points of line haul (2500 = 25%); only for percent_of_line_haul.
  payPercentBp: number | null;
}

// One contract named in a KPI note ("Raman Sep 20", "Frey · lease-purchase ends Nov 15", "Reed · starts Sep 8").
export interface EmployeeContractKpiEntry {
  contractId: string;
  employeeId: string;
  fullName: string;
  lastName: string;
  contractType: EmployeeContractType;
  startsOn: string;
  renewsOn: string;
}

// Computed over every contract of the organization; never filtered by q or status.
export interface EmployeeContractsSummary {
  // Organization business date (D4); the web's same-year rule for "Start"/"Renews" uses it.
  asOf: string;
  contractCount: number;
  activeCount: number;
  // status renewal_due, by renewsOn then list position.
  renewalsDue: EmployeeContractKpiEntry[];
  // role owner_operator, in list order.
  ownerOperators: EmployeeContractKpiEntry[];
  // status draft, in list order.
  drafts: EmployeeContractKpiEntry[];
}

export interface EmployeeContractsMeta extends PageMeta {
  summary: EmployeeContractsSummary;
}

export type EmployeeContractsResponse = ApiSuccess<EmployeeContractRow[], EmployeeContractsMeta>;

// ─── GET /hr/onboarding ──────────────────────────────────────────────────

export interface OnboardingCaseRow {
  id: string;
  candidateName: string;
  // Set once the candidate is an employee.
  employeeId: string | null;
  role: EmployeeRole;
  stage: OnboardingStage;
  startedOn: string;
  owner: HrEmployeeRef;
  // 0–100, stored.
  progressPercent: number;
  nextStep: string;
  // Rendered as "<nextStep> · <Mon D>" when set.
  nextStepOn: string | null;
  // Set iff stage complete.
  completedOn: string | null;
  // Labels of the case's pending document requests, by request position; Runtruck1 docsPending = length > 0.
  pendingDocumentLabels: string[];
}

// A case awaiting documents and the first pending document it waits on ("MVR consent").
export interface OnboardingAwaitingDocuments {
  caseId: string;
  candidateName: string;
  firstPendingLabel: string;
}

// Computed over every case of the organization; never filtered by q or stage.
export interface OnboardingCasesSummary {
  asOf: string;
  // The org week (Monday–Sunday containing asOf) and the calendar quarter's first day.
  weekStart: string;
  weekEnd: string;
  quarterStart: string;
  caseCount: number;
  // stage ≠ complete.
  inProgressCount: number;
  inOrientationCount: number;
  // startedOn within weekStart…weekEnd.
  startedThisWeekCount: number;
  // Cases with a pending request, in list order.
  awaitingDocuments: OnboardingAwaitingDocuments[];
  // stage complete and completedOn ≥ quarterStart.
  completedThisQuarterCount: number;
}

export interface OnboardingCasesMeta extends PageMeta {
  summary: OnboardingCasesSummary;
}

export type OnboardingCasesResponse = ApiSuccess<OnboardingCaseRow[], OnboardingCasesMeta>;
