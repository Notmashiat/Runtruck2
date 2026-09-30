import type {
  ComplianceReminderRow,
  ComplianceRemindersMeta,
  DriverListItem,
  DriverListMeta,
  TrailerListItem,
  TrailerListMeta,
  TruckListItem,
  TruckListMeta,
} from '@runtruck/types';
import { apiQuery, useApiQuery } from './query';

// Fleet reads (docs/api/fleet.md §5). Each screen requests one bounded page and filters it
// locally (01 §3). The same definitions serve server prefetching (page.tsx) and the hooks.
// Keys start with the resource, so New Load's invalidate(['drivers']) refreshes the roster.

export const driversQuery = apiQuery<DriverListItem[], DriverListMeta>(['drivers', 'list'], '/drivers?limit=500');
export const trucksQuery = apiQuery<TruckListItem[], TruckListMeta>(['trucks', 'list'], '/trucks?limit=500');
export const trailersQuery = apiQuery<TrailerListItem[], TrailerListMeta>(['trailers', 'list'], '/trailers?limit=500');

// The Drivers tab "Compliance watchlist" and "Docs to renew" (fleet.md §5.1, decision F1).
// The endpoint belongs to the safety domain (docs/api/safety.md §4); only this tab reads it.
export const complianceRemindersQuery = apiQuery<ComplianceReminderRow[], ComplianceRemindersMeta>(
  ['compliance-reminders', 'list'],
  '/compliance-reminders?limit=500',
);

// A read the member may not make is never sent: it stays pending, which renders exactly
// like a refusal (implementation-brief §4 rule 3).
export const useDrivers = (enabled = true) => useApiQuery(driversQuery, { enabled });
export const useTrucks = (enabled = true) => useApiQuery(trucksQuery, { enabled });
export const useTrailers = (enabled = true) => useApiQuery(trailersQuery, { enabled });
export const useComplianceReminders = (enabled = true) => useApiQuery(complianceRemindersQuery, { enabled });
