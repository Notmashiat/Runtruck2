import { Injectable } from '@nestjs/common';
import { toDriverRow } from '@runtruck/calculations';
import type { DriverListItem, DriverListMeta } from '@runtruck/types';
import type { DriverListQuery } from '@runtruck/validation';
import type { AuthContext } from '../auth/auth-context.js';
import { ClockService } from '../common/clock/clock.service.js';
import { orgWeek, yearStart } from './business-periods.js';
import { summarizeDrivers, toDriverRecord } from './drivers.mapper.js';
import { DriversRepository } from './drivers.repository.js';
import { pageInMemory } from '../common/list/list-query.js';

@Injectable()
export class DriversService {
  constructor(
    private readonly repository: DriversRepository,
    private readonly clock: ClockService,
  ) {}

  // GET /drivers (docs/api/fleet.md §2): every driver of the organization, summarized,
  // then filtered by the pill (dutyStatus) and q, then paged.
  async list(ctx: AuthContext, query: DriverListQuery): Promise<{ data: DriverListItem[]; meta: DriverListMeta }> {
    const today = this.clock.today(ctx.timezone);
    const { weekStart, weekEnd } = orgWeek(today);
    const ytdStart = yearStart(today);

    const records = (await this.repository.listAll(ctx.organizationId, { today, weekStart, weekEnd, ytdStart })).map(toDriverRecord);
    const summary = summarizeDrivers(records, { asOf: today, weekStart, weekEnd, ytdStart });

    const items = records.map((r) => r.item);
    const filtered = query.dutyStatus ? items.filter((d) => d.dutyStatus === query.dutyStatus) : items;
    const { page, total } = pageInMemory(filtered, query, toDriverRow);
    return { data: page, meta: { total, limit: query.limit, offset: query.offset, summary } };
  }
}
