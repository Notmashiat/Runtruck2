import { Injectable } from '@nestjs/common';
import { toFacilitySearchRow } from '@runtruck/calculations';
import type { FacilityListItem, PageMeta } from '@runtruck/types';
import type { FacilityListQuery } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { pageInMemory } from '../common/list/list-query.js';
import { FacilitiesRepository } from './facilities.repository.js';

@Injectable()
export class FacilitiesService {
  constructor(private readonly repository: FacilitiesRepository) {}

  // GET /facilities (docs/api/facilities.md §2): every facility, then q over name, address
  // line, city, state and postal code, then paging.
  async list(ctx: AuthContext, query: FacilityListQuery): Promise<{ data: FacilityListItem[]; meta: PageMeta }> {
    const facilities = await this.repository.listAll(ctx.organizationId);
    const { page, total } = pageInMemory(facilities, query, toFacilitySearchRow);
    return { data: page, meta: { total, limit: query.limit, offset: query.offset } };
  }
}
