import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import type { LoadDetail } from '@runtruck/types';
import {
  createLoadSchema,
  type CreateLoadBody,
  listLoadsQuerySchema,
  type ListLoadsQuery,
  loadIdParamSchema,
  type LoadIdParam,
  loadNumberParamSchema,
  type LoadNumberParam,
} from '@runtruck/validation';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import type { AuthContext } from '../auth/auth-context.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { LoadsService } from './loads.service.js';

// docs/api/loads.md: the Loads board, the load detail and New Load.
@Controller('loads')
export class LoadsController {
  constructor(private readonly loads: LoadsService) {}

  @Get()
  @RequirePermissions('loads.view')
  async list(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(listLoadsQuerySchema)) query: ListLoadsQuery) {
    const { data, meta } = await this.loads.list(ctx, query);
    return withMeta(data, meta);
  }

  @Get('by-number/:loadNumber')
  @RequirePermissions('loads.view')
  byNumber(@Auth() ctx: AuthContext, @Param(new ZodValidationPipe(loadNumberParamSchema)) params: LoadNumberParam): Promise<LoadDetail> {
    return this.loads.detail(ctx, { loadNumber: params.loadNumber });
  }

  @Get(':id')
  @RequirePermissions('loads.view')
  byId(@Auth() ctx: AuthContext, @Param(new ZodValidationPipe(loadIdParamSchema)) params: LoadIdParam): Promise<LoadDetail> {
    return this.loads.detail(ctx, { id: params.id });
  }

  // loads.assign is additionally checked in the service when the body assigns (§6.3 S1).
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('loads.create')
  create(@Auth() ctx: AuthContext, @Body(new ZodValidationPipe(createLoadSchema)) body: CreateLoadBody): Promise<LoadDetail> {
    return this.loads.create(ctx, body);
  }
}
