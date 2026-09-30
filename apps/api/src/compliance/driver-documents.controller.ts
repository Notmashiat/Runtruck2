import { Controller, Get, Query } from '@nestjs/common';
import { type ListDriverDocumentsQuery, listDriverDocumentsQuerySchema } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { ComplianceService } from './compliance.service.js';

// Safety › Driver Documents (docs/api/safety.md §3). Read-only: "Request document" is an
// inert stub (safety.md §8). `compliance.view` covers the driver names (decision S2).
@Controller('driver-documents')
export class DriverDocumentsController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get()
  @RequirePermissions('compliance.view')
  async list(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(listDriverDocumentsQuerySchema)) query: ListDriverDocumentsQuery) {
    const { data, meta } = await this.compliance.listDriverDocuments(ctx, query);
    return withMeta(data, meta);
  }
}
