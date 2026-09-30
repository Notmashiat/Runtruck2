import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import {
  type ApproveSettlementsInput,
  approveSettlementsSchema,
  type ListSettlementsQuery,
  listSettlementsQuerySchema,
} from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { SettlementsService } from './settlements.service.js';

// Accounting › Payroll: the pay period's settlements and "Approve all" / "Run settlements"
// (docs/api/settlements.md).
@Controller('settlements')
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get()
  @RequirePermissions('settlements.view')
  async list(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(listSettlementsQuerySchema)) query: ListSettlementsQuery) {
    const { rows, meta } = await this.settlements.list(ctx, query);
    return withMeta(rows, meta);
  }

  // A sensitive financial write: settlements.approve authorizes the transition and
  // settlements.view the list it returns (§3, 07 §8 item 7). 200, not 201: nothing is created.
  @Post('approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('settlements.approve', 'settlements.view')
  async approve(@Auth() ctx: AuthContext, @Body(new ZodValidationPipe(approveSettlementsSchema)) body: ApproveSettlementsInput) {
    const { rows, meta } = await this.settlements.approve(ctx, body);
    return withMeta(rows, meta);
  }
}
