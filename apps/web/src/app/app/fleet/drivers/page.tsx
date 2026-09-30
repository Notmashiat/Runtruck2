import { DriversTab } from '@/components/fleet/DriversTab';
import { complianceRemindersQuery, driversQuery } from '@/lib/api/fleet';
import { Prefetch } from '@/lib/api/prefetch';
import type { ApiQueryDef } from '@/lib/api/query';
import { getMe } from '@/lib/api/server';

// Fleet › Drivers. The first paint has the roster and the watchlist: both reads are
// prefetched on the server for the member's permissions (implementation-brief §4 rule 1).
export default async function DriversPage() {
  const me = await getMe();
  const permissions = me?.permissions ?? [];
  const queries: ApiQueryDef<unknown, object>[] = [];
  if (permissions.includes('drivers.view')) queries.push(driversQuery);
  if (permissions.includes('compliance.view')) queries.push(complianceRemindersQuery);
  return (
    <Prefetch queries={queries}>
      <DriversTab />
    </Prefetch>
  );
}
