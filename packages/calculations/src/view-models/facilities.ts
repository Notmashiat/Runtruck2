// facilities view-model builders and label/tone maps: turn API DTOs into Runtruck1-shaped
// display rows. Shared by the web (rendering + live search) and the API (server-side q)
// so both match identically (docs/03-database.md §1.11). Specified in docs/api/facilities.md.
//
// Runtruck1 has no facility screen (/app/facilities is "coming soon"), so there is no row
// to reproduce; this is only the searchable projection of GET /facilities (facilities.md §2.3).

import type { FacilityListItem } from '@runtruck/types';

/** The searchable fields of a facility; null values are never matched. `ref` is never searched. */
export interface FacilitySearchRowVm {
  name: string;
  addressLine1: string | null;
  city: string;
  state: string;
  postalCode: string | null;
  ref: { id: string };
}

export function toFacilitySearchRow(f: FacilityListItem): FacilitySearchRowVm {
  return { name: f.name, addressLine1: f.addressLine1, city: f.city, state: f.state, postalCode: f.postalCode, ref: { id: f.id } };
}
