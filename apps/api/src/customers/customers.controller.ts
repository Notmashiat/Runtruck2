import { Controller, Get, Query } from '@nestjs/common';
import {
  type CustomerListQuery,
  customerListQuerySchema,
  type CustomerOptionsQuery,
  customerOptionsQuerySchema,
} from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { Auth, RequirePermissions } from '../auth/decorators.js';
import { withMeta } from '../common/http/envelope.interceptor.js';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe.js';
import { CustomersService } from './customers.service.js';

// CRM (docs/api/customers.md §2) and the New Load "Customer" / "Bill to" selects (§2.8).
// Read-only: "+ Add Customer" is an inert stub (§4).
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions('customers.view')
  async list(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(customerListQuerySchema)) query: CustomerListQuery) {
    const { data, meta } = await this.customers.list(ctx, query);
    return withMeta(data, meta);
  }

  // Declared before any future GET /customers/:id so "options" is never read as an id.
  @Get('options')
  @RequirePermissions('customers.view')
  async options(@Auth() ctx: AuthContext, @Query(new ZodValidationPipe(customerOptionsQuerySchema)) query: CustomerOptionsQuery) {
    const { data, meta } = await this.customers.options(ctx, query);
    return withMeta(data, meta);
  }
}
