import type { TruckListItem, TruckListSummary } from '@runtruck/types';

// KPI figures for Fleet › Trucks over every truck of the organization (docs/api/fleet.md §3.4).
export function summarizeTrucks(trucks: readonly TruckListItem[]): TruckListSummary {
  const odometerTotal = trucks.reduce((sum, t) => sum + t.odometerMiles, 0);
  return {
    truckCount: trucks.length,
    // Unrounded; the web rounds ("Avg 380K mi").
    averageOdometerMiles: trucks.length === 0 ? null : odometerTotal / trucks.length,
    inServiceCount: trucks.filter((t) => t.status === 'in_service').length,
    inShopUnitNumbers: trucks.filter((t) => t.status === 'in_shop').map((t) => t.unitNumber),
    serviceDue: trucks
      .filter((t) => t.status === 'service_due')
      .map((t) => ({
        truckId: t.id,
        unitNumber: t.unitNumber,
        milesUntilService: t.nextServiceMiles === null ? null : t.nextServiceMiles - t.odometerMiles,
      })),
  };
}
