import type {
  ClaimRow,
  ClaimsMeta,
  DriverDocumentRow,
  DriverDocumentsMeta,
  ViolationRow,
  ViolationsMeta,
  WorkOrderRow,
  WorkOrdersMeta,
} from '@runtruck/types';
import { apiQuery, useApiQuery } from './query';

// Safety reads (docs/api/safety.md §7). Each screen requests one bounded page, never sends
// q, and filters locally over the shared view-model (01 §3). The same definitions serve
// server prefetching (page.tsx) and the hooks. The Fleet › Drivers watchlist read
// (GET /compliance-reminders) is declared by its only consumer, lib/api/fleet.ts.

export const workOrdersQuery = apiQuery<WorkOrderRow[], WorkOrdersMeta>(['work-orders', 'list'], '/work-orders?limit=500');
export const driverDocumentsQuery = apiQuery<DriverDocumentRow[], DriverDocumentsMeta>(
  ['driver-documents', 'list'],
  '/driver-documents?limit=500',
);
export const violationsQuery = apiQuery<ViolationRow[], ViolationsMeta>(['violations', 'list'], '/violations?limit=500');
export const claimsQuery = apiQuery<ClaimRow[], ClaimsMeta>(['claims', 'list'], '/claims?limit=500');

// A read the member may not make is never sent: it stays pending, which renders exactly
// like a refusal (implementation-brief §4 rule 3).
export const useWorkOrders = (enabled = true) => useApiQuery(workOrdersQuery, { enabled });
export const useDriverDocuments = (enabled = true) => useApiQuery(driverDocumentsQuery, { enabled });
export const useViolations = (enabled = true) => useApiQuery(violationsQuery, { enabled });
export const useClaims = (enabled = true) => useApiQuery(claimsQuery, { enabled });
