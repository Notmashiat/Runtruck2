import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@runtruck/database';
import type { FacilityListItem } from '@runtruck/types';
import { eq, sql } from 'drizzle-orm';
import { type Database, DB } from '../database/database.module.js';

const { facilities } = schema;

@Injectable()
export class FacilitiesRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Every facility of the organization by name (docs/api/facilities.md §2.2, §2.4): names
  // are unique per organization case-insensitively; byte order keeps the result independent
  // of the database locale.
  async listAll(organizationId: string): Promise<FacilityListItem[]> {
    return this.db
      .select({
        id: facilities.id,
        name: facilities.name,
        kind: facilities.kind,
        addressLine1: facilities.addressLine1,
        city: facilities.city,
        state: facilities.state,
        postalCode: facilities.postalCode,
        timezone: facilities.timezone,
        marketCity: facilities.marketCity,
        marketState: facilities.marketState,
        marketShort: facilities.marketShort,
      })
      .from(facilities)
      .where(eq(facilities.organizationId, organizationId))
      .orderBy(sql`lower(${facilities.name}) collate "C"`, facilities.id);
  }
}
