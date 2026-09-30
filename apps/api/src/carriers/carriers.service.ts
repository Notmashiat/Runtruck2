import { Injectable } from '@nestjs/common';
import { toCarrierVm } from '@runtruck/calculations';
import type { CarrierListItem, PageMeta } from '@runtruck/types';
import type { CarrierListQuery } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { pageInMemory } from '../common/list/list-query.js';
import { CarriersRepository } from './carriers.repository.js';

@Injectable()
export class CarriersService {
  constructor(private readonly repository: CarriersRepository) {}

  // GET /carriers (docs/api/carriers.md §2): every carrier, then q over the Runtruck1
  // Carrier strings ("Sunridge Freight (own fleet)", "MC 604117", "DOT 1780342"), then paging.
  async list(ctx: AuthContext, query: CarrierListQuery): Promise<{ data: CarrierListItem[]; meta: PageMeta }> {
    const carriers = await this.repository.listAll(ctx.organizationId);
    const { page, total } = pageInMemory(carriers, query, toCarrierVm);
    return { data: page, meta: { total, limit: query.limit, offset: query.offset } };
  }
}
