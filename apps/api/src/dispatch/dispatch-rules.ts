import type { CreateLoadBody } from '@runtruck/validation';

// Pure dispatch rules of docs/09-dispatch-lifecycle.md §3.1 and §4 for New Load.

export type Haul = CreateLoadBody['haul'];

// E1: the body assigns when it names an own-fleet driver, truck or trailer, or is hauled
// by a partner carrier (07 §8 item 2); it then needs loads.assign besides loads.create.
export function haulAssigns(haul: Haul): boolean {
  if (haul.hauledBy === 'partner_carrier') return true;
  return haul.driverId !== null || haul.truckId !== null || haul.trailerId !== null;
}

export interface DispatchValues {
  driverId: string | null;
  truckId: string | null;
  trailerId: string | null;
  driverName: string | null;
  truckNumber: string | null;
  trailerNumber: string | null;
}

// The live dispatch row New Load writes (09 §4), or null when nothing is assigned yet:
// own fleet → references (any of driver/truck/trailer); partner → free text (any of
// driver name / truck # / trailer #). E3: never both kinds in one row.
export function dispatchValues(haul: Haul): DispatchValues | null {
  if (haul.hauledBy === 'own_fleet') {
    if (haul.driverId === null && haul.truckId === null && haul.trailerId === null) return null;
    return { driverId: haul.driverId, truckId: haul.truckId, trailerId: haul.trailerId, driverName: null, truckNumber: null, trailerNumber: null };
  }
  if (haul.driverName === null && haul.truckNumber === null && haul.trailerNumber === null) return null;
  return { driverId: null, truckId: null, trailerId: null, driverName: haul.driverName, truckNumber: haul.truckNumber, trailerNumber: haul.trailerNumber };
}

// Pay columns (loads_pay_ck): driver pay only on own-fleet loads (0 → none, L10), the
// carrier rate only on brokered loads — never both.
export function payColumns(haul: Haul): { driverPayCents: number | null; carrierRateCents: number | null } {
  if (haul.hauledBy === 'own_fleet') return { driverPayCents: haul.driverPayCents && haul.driverPayCents > 0 ? haul.driverPayCents : null, carrierRateCents: null };
  return { driverPayCents: null, carrierRateCents: haul.carrierRateCents };
}
