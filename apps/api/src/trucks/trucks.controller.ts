import { Controller, Get, Query } from '@nestjs/common';
import { type TruckListQuery, truckListQuerySchema } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { TrucksService } from './trucks.service.js';

// Fleet › Trucks and the New Load "Truck" select (docs/api/fleet.md §3). Read-only:
// "Log service" and "+ Add Unit" are inert stubs (fleet.md §6).
@Controller('trucks')
export class TrucksController {
  constructor(private readonly trucks: TrucksService) {}

  @Get()
  @RequirePermissions('trucks.view')
  async list(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(truckListQuerySchema)) query: TruckListQuery) {
    const { data, meta } = await this.trucks.list(ctx, query);
    return withMeta(data, meta);
  }
}
