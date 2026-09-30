import type { ApiSuccess } from '@runtruck/types';
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { LoadDetailPage } from '@/components/loads/LoadDetailPage';
import { firstBoardLoadQuery, loadByIdQuery, loadByNumberQuery, loadNumberFromParam } from '@/lib/api/loads';
import type { ApiQueryDef } from '@/lib/api/query';
import { getMe, ServerApiError, serverGet } from '@/lib/api/server';

// Reads one query on the server into the cache the page hydrates — the Prefetch mechanism
// (lib/api/prefetch.tsx: server fetch + dehydrate + HydrationBoundary with the same apiQuery
// definitions), but each answer decides the next read, so no request is sent twice.
async function read<T, M extends object>(queryClient: QueryClient, def: ApiQueryDef<T, M>): Promise<{ data?: ApiSuccess<T, M>; error?: unknown }> {
  try {
    return { data: await queryClient.query({ queryKey: def.queryKey, queryFn: () => serverGet<T, M>(def.path) }) };
  } catch (error) {
    return { error };
  }
}

// The load detail (/app/loads/L-40218). The first paint has the load: GET
// /loads/by-number/:n for a well-formed number, and — when the segment is not a load
// number, the number is unknown (404) or the load is archived — the first board load that
// Runtruck1 showed instead (docs/api/loads.md §8.2.1, D6). A refused or failed read is not
// hydrated; the client then shows the pending/error state. Nothing is requested without
// loads.view.
export default async function LoadDetailRoute({ params }: { params: Promise<{ loadNumber: string }> }) {
  const { loadNumber } = await params;
  const me = await getMe();
  const queryClient = new QueryClient();
  let missingOnServer = false;
  if (me?.permissions.includes('loads.view')) {
    const n = loadNumberFromParam(loadNumber);
    let fallback = n === null;
    if (n !== null) {
      const byNumber = await read(queryClient, loadByNumberQuery(n));
      missingOnServer = byNumber.error instanceof ServerApiError && byNumber.error.code === 'LOAD_NOT_FOUND';
      fallback = missingOnServer || (byNumber.data !== undefined && byNumber.data.data.archivedAt !== null);
    }
    if (fallback) {
      const first = await read(queryClient, firstBoardLoadQuery);
      const id = first.data?.data[0]?.id;
      if (id !== undefined) await read(queryClient, loadByIdQuery(id));
    }
  }
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <LoadDetailPage missingOnServer={missingOnServer} />
    </HydrationBoundary>
  );
}
