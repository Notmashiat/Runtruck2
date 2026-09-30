import type { TrailerListItem, TrailerListSummary, TrailerLocation } from '@runtruck/types';
import type { TrailerDbRow } from './trailers.repository.js';

// Pure mapping and aggregation for GET /trailers (docs/api/fleet.md §4). Trailer status and
// location are stored facts, never derived from loads (fleet-hr-safety B10, B11).

// The CHECK trailers_location_ck guarantees the columns each kind needs; a row that breaks
// it is a data-integrity fault, reported as an internal error rather than rendered wrongly.
export function toTrailerLocation(row: TrailerDbRow): TrailerLocation {
  switch (row.locationKind) {
    case 'yard':
      if (row.locationFacilityId === null || row.facilityName === null || row.facilityCity === null) break;
      return { kind: 'yard', facilityId: row.locationFacilityId, facilityName: row.facilityName, city: row.facilityCity };
    case 'en_route':
      if (row.locationRoute === null) break;
      return { kind: 'en_route', route: row.locationRoute };
    case 'city':
      if (row.locationCity === null || row.locationState === null) break;
      return { kind: 'city', city: row.locationCity, state: row.locationState };
  }
  throw new Error(`Trailer ${row.id} has an incomplete ${row.locationKind} location`);
}

export function toTrailerItem(row: TrailerDbRow): TrailerListItem {
  return {
    id: row.id,
    unitNumber: row.unitNumber,
    trailerType: row.trailerType,
    lengthFt: row.lengthFt,
    status: row.status,
    location: toTrailerLocation(row),
  };
}

// KPI figures for Fleet › Trailers over every trailer of the organization (fleet.md §4.4).
export function summarizeTrailers(trailers: readonly TrailerListItem[]): TrailerListSummary {
  const loaded = trailers.filter((t) => t.status === 'loaded');
  const empty = trailers.filter((t) => t.status === 'empty');
  const rollingCount = loaded.filter((t) => t.location.kind === 'en_route').length;
  return {
    trailerCount: trailers.length,
    typeCounts: {
      reefer: trailers.filter((t) => t.trailerType === 'reefer').length,
      dry_van: trailers.filter((t) => t.trailerType === 'dry_van').length,
      flatbed: trailers.filter((t) => t.trailerType === 'flatbed').length,
    },
    loadedCount: loaded.length,
    rollingCount,
    // Runtruck1's formula.
    atShippersCount: loaded.length - rollingCount,
    emptyCount: empty.length,
    emptyAtYardCount: empty.filter((t) => t.location.kind === 'yard').length,
    inspectionUnitNumbers: trailers.filter((t) => t.status === 'inspection').map((t) => t.unitNumber),
  };
}
