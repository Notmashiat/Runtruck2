import { Controller, Get, Query } from '@nestjs/common';
import { type TrailerListQuery, trailerListQuerySchema } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { TrailersService } from './trailers.service.js';

// Fleet › Trailers and the New Load "Trailer" select (docs/api/fleet.md §4). Read-only:
// "+ Add Trailer" is an inert stub (fleet.md §6).
@Controller('trailers')
export class TrailersController {
  constructor(private readonly trailers: TrailersService) {}

  @Get()
  @RequirePermissions('trailers.view')
  async list(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(trailerListQuerySchema)) query: TrailerListQuery) {
    const { data, meta } = await this.trailers.list(ctx, query);
    return withMeta(data, meta);
  }
}
