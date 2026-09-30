import { z } from 'zod';
import { pageQuerySchema } from './common.js';

// HR input schemas — specified in docs/api/hr.md. Both endpoints are reads; the
// organization always comes from the session, so no schema accepts an organization id.

// docs/03-database.md §4.3 contract_status (stored lifecycle status).
export const employeeContractStatusSchema = z.enum(['active', 'renewal_due', 'expiring', 'draft']);

// docs/03-database.md §4.3 onboarding_stage.
export const onboardingStageSchema = z.enum(['application', 'background_check', 'road_test', 'orientation', 'complete']);

// GET /hr/contracts — limit/offset/q, plus an optional single status. Unknown keys are ignored.
export const listEmployeeContractsQuerySchema = pageQuerySchema.extend({
  status: employeeContractStatusSchema.optional(),
});

export type ListEmployeeContractsQuery = z.output<typeof listEmployeeContractsQuerySchema>;

// GET /hr/onboarding — limit/offset/q, plus an optional single stage. Unknown keys are ignored.
export const listOnboardingCasesQuerySchema = pageQuerySchema.extend({
  stage: onboardingStageSchema.optional(),
});

export type ListOnboardingCasesQuery = z.output<typeof listOnboardingCasesQuerySchema>;
