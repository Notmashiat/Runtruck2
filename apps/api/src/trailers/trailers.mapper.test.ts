import { describe, expect, it } from 'vitest';
import { summarizeTrailers, toTrailerItem } from './trailers.mapper.js';
import type { TrailerDbRow } from './trailers.repository.js';

const row = (over: Partial<TrailerDbRow>): TrailerDbRow => ({
  id: 'r',
  unitNumber: 'RF-27',
  trailerType: 'reefer',
  lengthFt: 53,
  status: 'loaded',
  locationKind: 'city',
  locationFacilityId: null,
  facilityName: null,
  facilityCity: null,
  locationRoute: null,
  locationCity: 'Bakersfield',
  locationState: 'CA',
  ...over,
});

const yard = {
  locationKind: 'yard' as const,
  locationFacilityId: 'f',
  facilityName: 'Sunridge yard',
  facilityCity: 'Modesto',
  locationCity: null,
  locationState: null,
};

describe('toTrailerItem', () => {
  it('maps each location kind', () => {
    expect(toTrailerItem(row({})).location).toEqual({ kind: 'city', city: 'Bakersfield', state: 'CA' });
    expect(toTrailerItem(row(yard)).location).toEqual({ kind: 'yard', facilityId: 'f', facilityName: 'Sunridge yard', city: 'Modesto' });
    expect(
      toTrailerItem(row({ locationKind: 'en_route', locationRoute: 'I-80', locationCity: null, locationState: null })).location,
    ).toEqual({
      kind: 'en_route',
      route: 'I-80',
    });
  });

  it('refuses a row that breaks trailers_location_ck', () => {
    expect(() => toTrailerItem(row({ locationKind: 'en_route', locationRoute: null }))).toThrow(/incomplete en_route location/);
  });
});

describe('summarizeTrailers (fleet.md §4.4)', () => {
  it('reproduces the seeded KPI figures', () => {
    const seed = [
      row({ unitNumber: 'RF-27' }),
      row({ unitNumber: 'RF-09', status: 'empty', ...yard }),
      row({ unitNumber: 'RF-88', locationKind: 'en_route', locationRoute: 'I-80', locationCity: null, locationState: null }),
      row({ unitNumber: 'DV-51', trailerType: 'dry_van', locationCity: 'Stockton' }),
      row({ unitNumber: 'DV-88', trailerType: 'dry_van', status: 'empty', ...yard }),
      row({ unitNumber: 'DV-14', trailerType: 'dry_van', status: 'empty', locationCity: 'Las Vegas', locationState: 'NV' }),
      row({ unitNumber: 'FB-04', trailerType: 'flatbed', lengthFt: 48, locationCity: 'Redding' }),
      row({ unitNumber: 'FB-12', trailerType: 'flatbed', lengthFt: 48, status: 'inspection', ...yard }),
    ].map(toTrailerItem);
    expect(summarizeTrailers(seed)).toEqual({
      trailerCount: 8,
      typeCounts: { reefer: 3, dry_van: 3, flatbed: 2 },
      loadedCount: 4,
      rollingCount: 1,
      atShippersCount: 3,
      emptyCount: 3,
      emptyAtYardCount: 2,
      inspectionUnitNumbers: ['FB-12'],
    });
  });

  it('has every type key for an empty list', () => {
    expect(summarizeTrailers([]).typeCounts).toEqual({ reefer: 0, dry_van: 0, flatbed: 0 });
  });
});
