import type { TruckListItem } from '@runtruck/types';
import { describe, expect, it } from 'vitest';
import { summarizeTrucks } from './trucks.mapper.js';

const truck = (
  unitNumber: string,
  odometerMiles: number,
  nextServiceMiles: number | null,
  status: TruckListItem['status'],
): TruckListItem => ({
  id: unitNumber,
  unitNumber,
  make: 'Make',
  model: 'Model',
  modelYear: 2020,
  plateState: 'CA',
  plateNumber: 'X',
  assignedDriver: null,
  odometerMiles,
  nextServiceMiles,
  status,
});

describe('summarizeTrucks (fleet.md §3.4)', () => {
  it('reproduces the seeded KPI figures', () => {
    const seed = [
      truck('T-103', 318440, 342000, 'in_service'),
      truck('T-107', 402190, 425000, 'in_service'),
      truck('T-109', 141220, 165000, 'in_service'),
      truck('T-114', 528900, 529800, 'service_due'),
      truck('T-118', 611780, null, 'in_shop'),
      truck('T-121', 275610, 298000, 'in_service'),
    ];
    expect(summarizeTrucks(seed)).toEqual({
      truckCount: 6,
      averageOdometerMiles: 379690,
      inServiceCount: 4,
      inShopUnitNumbers: ['T-118'],
      serviceDue: [{ truckId: 'T-114', unitNumber: 'T-114', milesUntilService: 900 }],
    });
  });

  it('keeps the average unrounded, null for an empty fleet, and a null distance without a reading', () => {
    expect(summarizeTrucks([truck('A', 1, 10, 'in_service'), truck('B', 2, 10, 'in_service')]).averageOdometerMiles).toBe(1.5);
    expect(summarizeTrucks([])).toEqual({
      truckCount: 0,
      averageOdometerMiles: null,
      inServiceCount: 0,
      inShopUnitNumbers: [],
      serviceDue: [],
    });
    expect(summarizeTrucks([truck('A', 5, null, 'service_due')]).serviceDue).toEqual([
      { truckId: 'A', unitNumber: 'A', milesUntilService: null },
    ]);
  });
});
