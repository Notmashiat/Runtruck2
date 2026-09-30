import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import type {
  PlannerColorCodeDeleteResultDto,
  PlannerColorCodeDto,
  PlannerEventDeleteResultDto,
  PlannerEventDto,
  PlannerResetResultDto,
  PlannerStopValuesDto,
} from '@runtruck/types';
import {
  type PlannerColorCodeCreateInput,
  plannerColorCodeCreateSchema,
  type PlannerColorCodeUpdateInput,
  plannerColorCodeUpdateSchema,
  type PlannerEventCreateInput,
  plannerEventCreateSchema,
  type PlannerEventsQuery,
  plannerEventsQuerySchema,
  type PlannerEventUpdateInput,
  plannerEventUpdateSchema,
  type PlannerRelatedLoadsQuery,
  plannerRelatedLoadsQuerySchema,
  plannerResetSchema,
  uuidSchema,
} from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { PlannerService } from './planner.service.js';

// docs/api/planner.md §1: the shared organization calendar (D8). Load-stop events, stop
// values and related loads additionally depend on loads.view, checked in the service (§2.3).
@Controller('planner')
export class PlannerController {
  constructor(private readonly planner: PlannerService) {}

  // §3.1
  @Get('events')
  @RequirePermissions('planner.view')
  async listEvents(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(plannerEventsQuerySchema)) query: PlannerEventsQuery) {
    const { data, meta } = await this.planner.listEvents(ctx, query);
    return withMeta(data, meta);
  }

  // §3.2 (201)
  @Post('events')
  @RequirePermissions('planner.manage')
  createEvent(
    @Auth() ctx: AuthContext,
    @Body(new ZodValidationPipe(plannerEventCreateSchema)) body: PlannerEventCreateInput,
  ): Promise<PlannerEventDto> {
    return this.planner.createEvent(ctx, body);
  }

  // §3.3
  @Patch('events/:id')
  @RequirePermissions('planner.manage')
  updateEvent(
    @Auth() ctx: AuthContext,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(plannerEventUpdateSchema)) body: PlannerEventUpdateInput,
  ): Promise<PlannerEventDto> {
    return this.planner.updateEvent(ctx, id, body);
  }

  // §3.4
  @Delete('events/:id')
  @RequirePermissions('planner.manage')
  deleteEvent(@Auth() ctx: AuthContext, @Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<PlannerEventDeleteResultDto> {
    return this.planner.deleteEvent(ctx, id);
  }

  // §3.5
  @Get('color-codes')
  @RequirePermissions('planner.view')
  async listColorCodes(@Auth() ctx: AuthContext) {
    const { data, meta } = await this.planner.listColorCodes(ctx);
    return withMeta(data, meta);
  }

  // §3.6 (201)
  @Post('color-codes')
  @RequirePermissions('planner.configure')
  createColorCode(
    @Auth() ctx: AuthContext,
    @Body(new ZodValidationPipe(plannerColorCodeCreateSchema)) body: PlannerColorCodeCreateInput,
  ): Promise<PlannerColorCodeDto> {
    return this.planner.createColorCode(ctx, body);
  }

  // §3.7
  @Patch('color-codes/:id')
  @RequirePermissions('planner.configure')
  updateColorCode(
    @Auth() ctx: AuthContext,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(plannerColorCodeUpdateSchema)) body: PlannerColorCodeUpdateInput,
  ): Promise<PlannerColorCodeDto> {
    return this.planner.updateColorCode(ctx, id, body);
  }

  // §3.8
  @Delete('color-codes/:id')
  @RequirePermissions('planner.configure')
  deleteColorCode(
    @Auth() ctx: AuthContext,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<PlannerColorCodeDeleteResultDto> {
    return this.planner.deleteColorCode(ctx, id);
  }

  // §3.9
  @Get('stop-values')
  @RequirePermissions('planner.view')
  stopValues(@Auth() ctx: AuthContext): Promise<PlannerStopValuesDto> {
    return this.planner.stopValues(ctx);
  }

  // §3.10
  @Get('related-loads')
  @RequirePermissions('planner.manage', 'loads.view')
  async relatedLoads(
    @Auth() ctx: AuthContext,
    @Query(new ZodValidationPipe(plannerRelatedLoadsQuerySchema)) query: PlannerRelatedLoadsQuery,
  ) {
    const { data, meta } = await this.planner.relatedLoads(ctx, query);
    return withMeta(data, meta);
  }

  // §3.11 (D8: planner.reset, Owner/Admin)
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('planner.reset')
  reset(@Auth() ctx: AuthContext, @Body(new ZodValidationPipe(plannerResetSchema)) _body: object): Promise<PlannerResetResultDto> {
    return this.planner.reset(ctx);
  }
}
