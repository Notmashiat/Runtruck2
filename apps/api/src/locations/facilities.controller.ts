import { Controller, Get, Query } from '@nestjs/common';
import { type FacilityListQuery, facilityListQuerySchema } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { FacilitiesService } from './facilities.service.js';

// Facility lookup (docs/api/facilities.md §2). No web consumer in this release: the
// /app/facilities page is Runtruck1's static "coming soon" card (decision FA1).
@Controller('facilities')
export class FacilitiesController {
  constructor(private readonly facilities: FacilitiesService) {}

  @Get()
  @RequirePermissions('locations.view')
  async list(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(facilityListQuerySchema)) query: FacilityListQuery) {
    const { data, meta } = await this.facilities.list(ctx, query);
    return withMeta(data, meta);
  }
}
