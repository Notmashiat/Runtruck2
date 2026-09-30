import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/context/SessionContext';
import { api } from './client';
import { carriersQuery } from './carriers';
import { customerOptionsQuery } from './customers';
import { driversQuery, trailersQuery, trucksQuery } from './fleet';
import { useApiQuery } from './query';

// The reference lists New Load reads from other domains (docs/api/loads.md §8.3.1):
// customer options, carriers, drivers, trucks and trailers, each one bounded page in the
// owning domain's order. The query definitions are the owning groups', so the cache is
// shared with CRM and Fleet. A list the member may not read is never requested; its
// select then offers only the blank option.
export function useNewLoadReferences() {
  const { can } = useSession();
  return {
    customers: useApiQuery(customerOptionsQuery, { enabled: can('customers.view') }).data?.data ?? [],
    carriers: useApiQuery(carriersQuery, { enabled: can('carriers.view') }).data?.data ?? [],
    drivers: useApiQuery(driversQuery, { enabled: can('drivers.view') }).data?.data ?? [],
    trucks: useApiQuery(trucksQuery, { enabled: can('trucks.view') }).data?.data ?? [],
    trailers: useApiQuery(trailersQuery, { enabled: can('trailers.view') }).data?.data ?? [],
  };
}

// Warms the same five lists before the dialog opens (the Header calls it when "+ New Load"
// is hovered or focused), so the selects are already filled when it opens. Only permitted
// lists are requested, fresh entries (staleTime) are reused, and a failure is left for the
// dialog's own read to show.
export function usePrefetchNewLoadReferences(): () => void {
  const { can } = useSession();
  const queryClient = useQueryClient();
  return () => {
    const defs = [
      can('customers.view') ? customerOptionsQuery : null,
      can('carriers.view') ? carriersQuery : null,
      can('drivers.view') ? driversQuery : null,
      can('trucks.view') ? trucksQuery : null,
      can('trailers.view') ? trailersQuery : null,
    ];
    for (const def of defs) {
      if (def) void queryClient.query({ queryKey: def.queryKey, queryFn: () => api.get(def.path) }).catch(() => undefined);
    }
  };
}
