import { Inject, Injectable } from '@nestjs/common';
import type { EmployeeContractPayBasis, EmployeeContractStatus, EmployeeContractType, EmployeeRole, OnboardingStage } from '@runtruck/types';
import { sql } from 'drizzle-orm';
import { type Database, DB } from '../database/database.module.js';

// HR reads (docs/api/hr.md §2.7, §3.7). HR lists are reference-size, so each endpoint
// reads every row of the organization in ONE statement whatever the number of rows.
// Every table read and every join is scoped to the organization. Candidate names and pay
// are personal/financial data: never logged here.

export interface ContractSqlRow extends Record<string, unknown> {
  id: string;
  role: EmployeeRole;
  contract_type: EmployeeContractType;
  status: EmployeeContractStatus;
  starts_on: string;
  renews_on: string;
  pay_basis: EmployeeContractPayBasis;
  pay_rate_cents: number | null;
  pay_percent_bp: number | null;
  employee_id: string;
  first_name: string;
  last_name: string;
}

export interface OnboardingSqlRow extends Record<string, unknown> {
  id: string;
  candidate_name: string;
  employee_id: string | null;
  role: EmployeeRole;
  stage: OnboardingStage;
  started_on: string;
  progress_percent: number;
  next_step: string;
  next_step_on: string | null;
  completed_on: string | null;
  owner_id: string;
  owner_first_name: string;
  owner_last_name: string;
  pending_labels: string[];
}

@Injectable()
export class HrRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Every contract of the organization with its employee, in list order (hr.md §2.2).
  async contracts(organizationId: string): Promise<ContractSqlRow[]> {
    const result = await this.db.execute<ContractSqlRow>(sql`
      SELECT c.id, c.role, c.contract_type, c.status, c.starts_on::text AS starts_on, c.renews_on::text AS renews_on,
             c.pay_basis, c.pay_rate_cents, c.pay_percent_bp,
             e.id AS employee_id, e.first_name, e.last_name
      FROM employee_contracts c
      JOIN employees e ON e.organization_id = c.organization_id AND e.id = c.employee_id
      WHERE c.organization_id = ${organizationId}
      ORDER BY c.position, c.id`);
    return result.rows;
  }

  // Every onboarding case of the organization with its owner and the labels of its pending
  // document requests (aggregated per case in a lateral subquery, never fetched per row),
  // in list order (hr.md §3.2, §3.7).
  async onboardingCases(organizationId: string): Promise<OnboardingSqlRow[]> {
    const result = await this.db.execute<OnboardingSqlRow>(sql`
      SELECT oc.id, oc.candidate_name, oc.employee_id, oc.role, oc.stage, oc.started_on::text AS started_on,
             oc.progress_percent, oc.next_step, oc.next_step_on::text AS next_step_on, oc.completed_on::text AS completed_on,
             ow.id AS owner_id, ow.first_name AS owner_first_name, ow.last_name AS owner_last_name,
             coalesce(req.pending_labels, '{}'::text[]) AS pending_labels
      FROM onboarding_cases oc
      JOIN employees ow ON ow.organization_id = oc.organization_id AND ow.id = oc.owner_employee_id
      LEFT JOIN LATERAL (
        SELECT array_agg(r.label ORDER BY r.position) AS pending_labels
        FROM onboarding_document_requests r
        WHERE r.organization_id = oc.organization_id AND r.onboarding_case_id = oc.id AND r.status = 'pending'
      ) req ON true
      WHERE oc.organization_id = ${organizationId}
      ORDER BY oc.position, oc.id`);
    return result.rows;
  }
}
