import { Injectable } from '@nestjs/common';
import { toTruckRow } from '@runtruck/calculations';
import type { TruckListItem, TruckListMeta } from '@runtruck/types';
import type { TruckListQuery } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { pageInMemory } from '../common/list/list-query.js';
import { summarizeTrucks } from './trucks.mapper.js';
import { TrucksRepository } from './trucks.repository.js';

@Injectable()
export class TrucksService {
  constructor(private readonly repository: TrucksRepository) {}

  // GET /trucks (docs/api/fleet.md §3): every truck, summarized, then q and paging.
  async list(ctx: AuthContext, query: TruckListQuery): Promise<{ data: TruckListItem[]; meta: TruckListMeta }> {
    const trucks = await this.repository.listAll(ctx.organizationId);
    const summary = summarizeTrucks(trucks);
    const { page, total } = pageInMemory(trucks, query, toTruckRow);
    return { data: page, meta: { total, limit: query.limit, offset: query.offset, summary } };
  }
}
