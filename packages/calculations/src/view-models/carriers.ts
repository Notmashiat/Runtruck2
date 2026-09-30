// carriers view-model builders and label/tone maps: turn API DTOs into Runtruck1-shaped
// display rows. Shared by the web (rendering + live search) and the API (server-side q)
// so both match identically (docs/03-database.md §1.11). Specified in docs/api/carriers.md.

import type { CarrierListItem } from '@runtruck/types';
import { EM_DASH } from '../format.js';

/** Runtruck1 `Carrier` (carriers.md §3). `ref` is never searched. */
export interface CarrierVm {
  name: string;
  mc: string;
  dot: string;
  ref: { id: string; isOwnFleet: boolean };
}

export function toCarrierVm(c: CarrierListItem): CarrierVm {
  return {
    name: c.isOwnFleet ? `${c.name} (own fleet)` : c.name,
    mc: c.mcNumber ? `MC ${c.mcNumber}` : EM_DASH,
    dot: c.dotNumber ? `DOT ${c.dotNumber}` : EM_DASH,
    ref: { id: c.id, isOwnFleet: c.isOwnFleet },
  };
}

// New Load "Hauled by = Own fleet" note. Without an own-fleet row the name, MC and DOT
// read "—" (decision CA3).
export function carrierOwnFleetNote(own: CarrierVm | undefined): string {
  return `${own?.name ?? EM_DASH} · ${own?.mc ?? EM_DASH} · ${own?.dot ?? EM_DASH}. Assign the driver, truck and trailer in Driver & equipment.`;
}

// New Load partner "Carrier" option text: "Valley Line Transport · MC 604117".
export function carrierOptionText(vm: CarrierVm): string {
  return `${vm.name} · ${vm.mc}`;
}
