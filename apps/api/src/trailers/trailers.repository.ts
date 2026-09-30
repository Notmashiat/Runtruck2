import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@runtruck/database';
import type { TrailerLocationKind, TrailerStatus, TrailerType } from '@runtruck/types';
import { and, eq } from 'drizzle-orm';
import { type Database, DB } from '../database/database.module.js';

const { facilities, trailers } = schema;

export interface TrailerDbRow {
  id: string;
  unitNumber: string;
  trailerType: TrailerType;
  lengthFt: number;
  status: TrailerStatus;
  locationKind: TrailerLocationKind;
  locationFacilityId: string | null;
  facilityName: string | null;
  facilityCity: string | null;
  locationRoute: string | null;
  locationCity: string | null;
  locationState: string | null;
}

@Injectable()
export class TrailersRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Every trailer of the organization with its yard facility, in one statement
  // (docs/api/fleet.md §4.6), in the hand-authored list order.
  async listAll(organizationId: string): Promise<TrailerDbRow[]> {
    return this.db
      .select({
        id: trailers.id,
        unitNumber: trailers.unitNumber,
        trailerType: trailers.trailerType,
        lengthFt: trailers.lengthFt,
        status: trailers.status,
        locationKind: trailers.locationKind,
        locationFacilityId: trailers.locationFacilityId,
        facilityName: facilities.name,
        facilityCity: facilities.city,
        locationRoute: trailers.locationRoute,
        locationCity: trailers.locationCity,
        locationState: trailers.locationState,
      })
      .from(trailers)
      .leftJoin(facilities, and(eq(facilities.organizationId, trailers.organizationId), eq(facilities.id, trailers.locationFacilityId)))
      .where(eq(trailers.organizationId, organizationId))
      .orderBy(trailers.position, trailers.id);
  }
}
