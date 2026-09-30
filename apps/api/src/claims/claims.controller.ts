import { Controller, Get, Query } from '@nestjs/common';
import { type ListClaimsQuery, listClaimsQuerySchema } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ClaimsService } from './claims.service.js';

// Safety › Settlements = cargo and liability claims (docs/api/safety.md §6; B12: the backend
// module is `claims`, never driver-pay settlements). Read-only: "+ New Claim" is an inert
// stub (safety.md §8). `claims.view` covers the claimant and load number (decision S2).
@Controller('claims')
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get()
  @RequirePermissions('claims.view')
  async list(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(listClaimsQuerySchema)) query: ListClaimsQuery) {
    const { data, meta } = await this.claims.list(ctx, query);
    return withMeta(data, meta);
  }
}
