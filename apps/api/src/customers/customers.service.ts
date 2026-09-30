import { Injectable } from '@nestjs/common';
import { toCustomerRow } from '@runtruck/calculations';
import type { CustomerListItem, CustomerListMeta, CustomerOption, PageMeta } from '@runtruck/types';
import type { CustomerListQuery, CustomerOptionsQuery } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { ClockService } from '../common/clock/clock.service.js';
import { yearStart } from '../drivers/business-periods.js';
import { pageInMemory } from '../common/list/list-query.js';
import { summarizeCustomers, toCustomerRecord } from './customers.mapper.js';
import { CustomersRepository } from './customers.repository.js';

@Injectable()
export class CustomersService {
  constructor(
    private readonly repository: CustomersRepository,
    private readonly clock: ClockService,
  ) {}

  // GET /customers (docs/api/customers.md §2): every customer with its aggregates,
  // summarized, then q over the Runtruck1 Customer strings, then paging.
  async list(ctx: AuthContext, query: CustomerListQuery): Promise<{ data: CustomerListItem[]; meta: CustomerListMeta }> {
    const today = this.clock.today(ctx.timezone);
    const ytdStart = yearStart(today);
    const records = (await this.repository.listAll(ctx.organizationId, ytdStart, today)).map(toCustomerRecord);
    const summary = summarizeCustomers(records, { asOf: today, ytdStart });
    const { page, total } = pageInMemory(
      records.map((r) => r.item),
      query,
      toCustomerRow,
    );
    return { data: page, meta: { total, limit: query.limit, offset: query.offset, summary } };
  }

  // GET /customers/options (customers.md §2.8): id, name and terms only; no aggregates.
  async options(ctx: AuthContext, query: CustomerOptionsQuery): Promise<{ data: CustomerOption[]; meta: PageMeta }> {
    const { rows, total } = await this.repository.listOptions(ctx.organizationId, query);
    return { data: rows, meta: { total, limit: query.limit, offset: query.offset } };
  }
}
