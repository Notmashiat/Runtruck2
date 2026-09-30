import { Controller, Get, Query } from '@nestjs/common';
import { type DriverListQuery, driverListQuerySchema } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { DriversService } from './drivers.service.js';

// Fleet › Drivers and the New Load "Driver" select (docs/api/fleet.md §2). Read-only:
// "+ Add Driver" is an inert stub (fleet.md §6).
@Controller('drivers')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get()
  @RequirePermissions('drivers.view')
  async list(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(driverListQuerySchema)) query: DriverListQuery) {
    const { data, meta } = await this.drivers.list(ctx, query);
    return withMeta(data, meta);
  }
}
