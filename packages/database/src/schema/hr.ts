import { sql } from 'drizzle-orm';
import { type AnyPgColumn, check, date, index, integer, pgEnum, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_columns.js';
import { tenantFk, tenantKey } from './_tenant.js';
import { organizationId, users } from './platform.js';

// Workforce: employees, employment contracts and onboarding. Specified in docs/03-database.md §5.4.

export const employeeStatus = pgEnum('employee_status', ['active', 'onboarding']);

// Runtruck1: Company driver / Owner-operator / Dispatcher / Mechanic.
export const employeeRole = pgEnum('employee_role', ['company_driver', 'owner_operator', 'dispatcher', 'mechanic']);

// Runtruck1: W-2 / 1099 / Lease-purchase.
export const contractType = pgEnum('contract_type', ['w2', 'form_1099', 'lease_purchase']);

// Runtruck1: Active / Renewal due / Expiring / Draft (stored, design brief §2).
export const contractStatus = pgEnum('contract_status', ['active', 'renewal_due', 'expiring', 'draft']);

// "$0.62 / mi", "25% of line haul", "$68,000 / yr", "$34.50 / hr". Also snapshotted on settlements.
export const payBasis = pgEnum('pay_basis', ['per_mile', 'percent_of_line_haul', 'annual_salary', 'hourly']);

// Runtruck1: Application / Background check / Road test / Orientation / Complete.
export const onboardingStage = pgEnum('onboarding_stage', ['application', 'background_check', 'road_test', 'orientation', 'complete']);

export const onboardingRequestStatus = pgEnum('onboarding_request_status', ['pending', 'received']);

export const employees = pgTable(
  'employees',
  {
    id: id(),
    organizationId: organizationId(),
    firstName: text().notNull(),
    // KPI notes use the last name ("Nakamura · 1h 45m", "Raman Sep 20").
    lastName: text().notNull(),
    status: employeeStatus().notNull(),
    // Set when the employee can sign in (Rosa Medina).
    userId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    tenantKey('employees', t),
    uniqueIndex('employees_org_user_uq')
      .on(t.organizationId, t.userId)
      .where(sql`${t.userId} is not null`),
    index('employees_org_name_idx').on(t.organizationId, t.lastName, t.firstName),
  ],
);

// Pay basis consistency, shared with settlements: rate for per-mile/hourly/salary, basis points for percent.
export const payBasisCheck = (name: string, basis: AnyPgColumn, rateCents: AnyPgColumn, percentBp: AnyPgColumn) =>
  check(
    name,
    sql`(${basis} = 'percent_of_line_haul' and ${percentBp} is not null and ${percentBp} between 1 and 10000 and ${rateCents} is null)
      or (${basis} <> 'percent_of_line_haul' and ${rateCents} is not null and ${rateCents} > 0 and ${percentBp} is null)`,
  );

export const employeeContracts = pgTable(
  'employee_contracts',
  {
    id: id(),
    organizationId: organizationId(),
    employeeId: uuid().notNull(),
    role: employeeRole().notNull(),
    contractType: contractType().notNull(),
    status: contractStatus().notNull(),
    startsOn: date({ mode: 'string' }).notNull(),
    // The "Renews" column: the renewal date, or the end of a fixed term (status expiring).
    renewsOn: date({ mode: 'string' }).notNull(),
    payBasis: payBasis().notNull(),
    // Cents per mile / per hour / per year; null for percent_of_line_haul.
    payRateCents: integer(),
    // Basis points of line haul (2500 = 25%); only for percent_of_line_haul.
    payPercentBp: integer(),
    position: integer().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('employee_contracts', t),
    tenantFk('employee_contracts_employee_fk', t.organizationId, t.employeeId, employees).onDelete('restrict'),
    index('employee_contracts_org_position_idx').on(t.organizationId, t.position),
    index('employee_contracts_org_employee_idx').on(t.organizationId, t.employeeId),
    check('employee_contracts_dates_ck', sql`${t.renewsOn} >= ${t.startsOn}`),
    payBasisCheck('employee_contracts_pay_ck', t.payBasis, t.payRateCents, t.payPercentBp),
  ],
);

export const onboardingCases = pgTable(
  'onboarding_cases',
  {
    id: id(),
    organizationId: organizationId(),
    candidateName: text().notNull(),
    // Set once the candidate is an employee (Jamal Reed, Evan Brooks).
    employeeId: uuid(),
    role: employeeRole().notNull(),
    stage: onboardingStage().notNull(),
    startedOn: date({ mode: 'string' }).notNull(),
    ownerEmployeeId: uuid().notNull(),
    // Not a function of the stage (Derek 35 and Kevin 30 share one), so it is stored.
    progressPercent: smallint().notNull(),
    nextStep: text().notNull(),
    // Rendered as "<next_step> · <MMM d>" when set.
    nextStepOn: date({ mode: 'string' }),
    completedOn: date({ mode: 'string' }),
    position: integer().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('onboarding_cases', t),
    tenantFk('onboarding_cases_employee_fk', t.organizationId, t.employeeId, employees).onDelete('restrict'),
    tenantFk('onboarding_cases_owner_fk', t.organizationId, t.ownerEmployeeId, employees).onDelete('restrict'),
    index('onboarding_cases_org_position_idx').on(t.organizationId, t.position),
    check('onboarding_cases_progress_ck', sql`${t.progressPercent} between 0 and 100`),
    check('onboarding_cases_completed_ck', sql`(${t.stage} = 'complete') = (${t.completedOn} is not null)`),
  ],
);

export const onboardingDocumentRequests = pgTable(
  'onboarding_document_requests',
  {
    id: id(),
    organizationId: organizationId(),
    onboardingCaseId: uuid().notNull(),
    // Stored as shown in KPI notes ("MVR consent", "medical card").
    label: text().notNull(),
    status: onboardingRequestStatus().notNull(),
    position: integer().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('onboarding_document_requests', t),
    tenantFk('onboarding_document_requests_case_fk', t.organizationId, t.onboardingCaseId, onboardingCases).onDelete('cascade'),
    uniqueIndex('onboarding_document_requests_case_position_uq').on(t.organizationId, t.onboardingCaseId, t.position),
  ],
);
