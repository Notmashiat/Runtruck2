import { Injectable } from '@nestjs/common';
import { toEmployeeContractRow, toOnboardingRow } from '@runtruck/calculations';
import type { EmployeeContractRow, EmployeeContractsMeta, OnboardingCaseRow, OnboardingCasesMeta } from '@runtruck/types';
import type { ListEmployeeContractsQuery, ListOnboardingCasesQuery } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { ClockService } from '../common/clock/clock.service.js';
import { pageInMemory } from '../common/list/list-query.js';
import { orgWeek, quarterStart } from '../compliance/windows.js';
import { summarizeContracts, summarizeOnboarding, toContractRecord, toOnboardingCase } from './hr.mapper.js';
import { HrRepository } from './hr.repository.js';

export interface ListResult<T, M> {
  data: T[];
  meta: M;
}

// HR read views (docs/api/hr.md). Each list reads every row of the organization, computes
// meta.summary over all of them (q and the filter never change a KPI), then applies the
// filter, then q over the shared view-model, then pages (hr.md §1.2).
@Injectable()
export class HrService {
  constructor(
    private readonly repository: HrRepository,
    private readonly clock: ClockService,
  ) {}

  // GET /hr/contracts (hr.md §2).
  async listContracts(ctx: AuthContext, query: ListEmployeeContractsQuery): Promise<ListResult<EmployeeContractRow, EmployeeContractsMeta>> {
    const today = this.clock.today(ctx.timezone);
    const records = (await this.repository.contracts(ctx.organizationId)).map(toContractRecord);
    const summary = summarizeContracts(records, today);

    const rows = records.map((r) => r.row);
    const filtered = query.status ? rows.filter((c) => c.status === query.status) : rows;
    const { page, total } = pageInMemory(filtered, query, (c) => toEmployeeContractRow(c, today));
    return { data: page, meta: { total, limit: query.limit, offset: query.offset, summary } };
  }

  // GET /hr/onboarding (hr.md §3).
  async listOnboarding(ctx: AuthContext, query: ListOnboardingCasesQuery): Promise<ListResult<OnboardingCaseRow, OnboardingCasesMeta>> {
    const today = this.clock.today(ctx.timezone);
    const cases = (await this.repository.onboardingCases(ctx.organizationId)).map(toOnboardingCase);
    const summary = summarizeOnboarding(cases, { asOf: today, ...orgWeek(today), quarterStart: quarterStart(today) });

    const filtered = query.stage ? cases.filter((c) => c.stage === query.stage) : cases;
    const { page, total } = pageInMemory(filtered, query, toOnboardingRow);
    return { data: page, meta: { total, limit: query.limit, offset: query.offset, summary } };
  }
}
