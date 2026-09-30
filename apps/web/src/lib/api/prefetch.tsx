import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ApiQueryDef } from './query';
import { serverGet } from './server';

// Server component: fetches the given API reads with the visitor's session and
// hydrates them into the client's TanStack Query cache, so the page's first paint
// already has its data (implementation-brief §4 rule 1). A refused (403) or failed
// read is simply not hydrated; the client then shows the pending/error state.
//
//   <Prefetch queries={[dashboardQuery]}><DashboardPage /></Prefetch>
//
// Only pass reads the member is permitted to make (check me.permissions first) so
// no request is sent that the API would refuse.
export async function Prefetch({ queries, children }: { queries: ApiQueryDef<unknown, object>[]; children: ReactNode }) {
  const queryClient = new QueryClient();
  await Promise.all(queries.map((q) => queryClient.prefetchQuery({ queryKey: q.queryKey, queryFn: () => serverGet(q.path) })));
  return <HydrationBoundary state={dehydrate(queryClient)}>{children}</HydrationBoundary>;
}
