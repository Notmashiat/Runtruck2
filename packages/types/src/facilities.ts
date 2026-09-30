// Facilities wire types — specified in docs/api/facilities.md.

import type { ApiSuccess, PageMeta } from './api.js';

/** `facility_kind` (not displayed; no Runtruck1 label). */
export type FacilityKind = 'shipper' | 'consignee' | 'crossdock' | 'port' | 'yard' | 'shop';

// ---------------------------------------------------------------------------
// GET /api/v1/facilities (docs/api/facilities.md §2)

export interface FacilityListItem {
  id: string;
  name: string;
  kind: FacilityKind;
  addressLine1: string | null;
  /** Address city ("Sparks"). */
  city: string;
  /** Two-letter state ("NV"). */
  state: string;
  postalCode: string | null;
  /** IANA zone; stop times at this facility are wall clock in it. */
  timezone: string;
  /** Route-label city when it differs from the address city ("Reno"). */
  marketCity: string | null;
  marketState: string | null;
  /** Short market for driver cards ("SLC"). */
  marketShort: string | null;
}

export type FacilityListResponse = ApiSuccess<FacilityListItem[], PageMeta>;
