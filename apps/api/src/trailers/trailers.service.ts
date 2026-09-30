import { Injectable } from '@nestjs/common';
import { toTrailerRow } from '@runtruck/calculations';
import type { TrailerListItem, TrailerListMeta } from '@runtruck/types';
import type { TrailerListQuery } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { pageInMemory } from '../common/list/list-query.js';
import { summarizeTrailers, toTrailerItem } from './trailers.mapper.js';
import { TrailersRepository } from './trailers.repository.js';

@Injectable()
export class TrailersService {
  constructor(private readonly repository: TrailersRepository) {}

  // GET /trailers (docs/api/fleet.md §4): every trailer, summarized, then q and paging.
  async list(ctx: AuthContext, query: TrailerListQuery): Promise<{ data: TrailerListItem[]; meta: TrailerListMeta }> {
    const trailers = (await this.repository.listAll(ctx.organizationId)).map(toTrailerItem);
    const summary = summarizeTrailers(trailers);
    const { page, total } = pageInMemory(trailers, query, toTrailerRow);
    return { data: page, meta: { total, limit: query.limit, offset: query.offset, summary } };
  }
}
