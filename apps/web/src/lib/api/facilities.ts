import type { FacilityListItem, PageMeta } from '@runtruck/types';
import { apiQuery, useApiQuery } from './query';

// Facility reads (docs/api/facilities.md). No screen reads facilities in this release:
// /app/facilities is Runtruck1's static "coming soon" page and calls nothing (decision
// FA1). The definition exists for future facility pickers.
export const facilitiesQuery = apiQuery<FacilityListItem[], PageMeta>(['facilities', 'list'], '/facilities?limit=500');

export const useFacilities = (enabled = true) => useApiQuery(facilitiesQuery, { enabled });
