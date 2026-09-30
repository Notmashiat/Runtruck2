// Carriers wire types — specified in docs/api/carriers.md.

import type { ApiSuccess, PageMeta } from './api.js';

// ---------------------------------------------------------------------------
// GET /api/v1/carriers (docs/api/carriers.md §2)

export interface CarrierListItem {
  id: string;
  /** Stored without " (own fleet)"; the web appends it when isOwnFleet. */
  name: string;
  /** Digits only ("604117"); rendered "MC 604117". */
  mcNumber: string | null;
  /** Digits only ("1780342"); rendered "DOT 1780342". */
  dotNumber: string | null;
  /** The organization's own operating authority (first in the list). */
  isOwnFleet: boolean;
}

export type CarrierListResponse = ApiSuccess<CarrierListItem[], PageMeta>;
