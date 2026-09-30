import { LoadsPage } from '@/components/loads/LoadsPage';
import { loadsBoardQuery } from '@/lib/api/loads';
import { Prefetch } from '@/lib/api/prefetch';
import type { ApiQueryDef } from '@/lib/api/query';
import { getMe } from '@/lib/api/server';

// The Loads board. The first paint has the board and its KPIs: GET /loads is prefetched on
// the server when the member holds loads.view (implementation-brief §4 rule 1).
export default async function LoadsRoute() {
  const me = await getMe();
  const queries: ApiQueryDef<unknown, object>[] = [];
  if (me?.permissions.includes('loads.view')) queries.push(loadsBoardQuery);
  return (
    <Prefetch queries={queries}>
      <LoadsPage />
    </Prefetch>
  );
}
