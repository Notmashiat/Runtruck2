import type { EmployeeContractRow, EmployeeContractsMeta, OnboardingCaseRow, OnboardingCasesMeta } from '@runtruck/types';
import { apiQuery, useApiQuery } from './query';

// HR reads (docs/api/hr.md §4). Each screen requests one bounded page, never sends q, and
// filters locally over the shared view-model (01 §3). The same definitions serve server
// prefetching (page.tsx) and the hooks.

export const employeeContractsQuery = apiQuery<EmployeeContractRow[], EmployeeContractsMeta>(
  ['hr', 'contracts'],
  '/hr/contracts?limit=500',
);
export const onboardingCasesQuery = apiQuery<OnboardingCaseRow[], OnboardingCasesMeta>(['hr', 'onboarding'], '/hr/onboarding?limit=500');

// A read the member may not make is never sent: it stays pending, which renders exactly
// like a refusal (implementation-brief §4 rule 3).
export const useEmployeeContracts = (enabled = true) => useApiQuery(employeeContractsQuery, { enabled });
export const useOnboardingCases = (enabled = true) => useApiQuery(onboardingCasesQuery, { enabled });
