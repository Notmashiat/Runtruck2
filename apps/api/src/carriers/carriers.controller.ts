import { Controller, Get, Query } from '@nestjs/common';
import { type CarrierListQuery, carrierListQuerySchema } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { CarriersService } from './carriers.service.js';

// Carrier lookup for the New Load "Carrier" section (docs/api/carriers.md §2). Read-only.
@Controller('carriers')
export class CarriersController {
  constructor(private readonly carriers: CarriersService) {}

  @Get()
  @RequirePermissions('carriers.view')
  async list(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(carrierListQuerySchema)) query: CarrierListQuery) {
    const { data, meta } = await this.carriers.list(ctx, query);
    return withMeta(data, meta);
  }
}
