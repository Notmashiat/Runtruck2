import { Controller, Get, Query } from '@nestjs/common';
import { type ListOnboardingCasesQuery, listOnboardingCasesQuerySchema } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { HrService } from './hr.service.js';

// HR › Onboarding (docs/api/hr.md §3). Read-only: "+ Start Onboarding" is an inert stub (hr.md §5).
@Controller('hr/onboarding')
export class OnboardingController {
  constructor(private readonly hr: HrService) {}

  @Get()
  @RequirePermissions('hr.view')
  async list(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(listOnboardingCasesQuerySchema)) query: ListOnboardingCasesQuery) {
    const { data, meta } = await this.hr.listOnboarding(ctx, query);
    return withMeta(data, meta);
  }
}
