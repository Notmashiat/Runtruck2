import type { ApiSuccess } from '@runtruck/types';
import { type QueryClient, useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { api, ApiError } from './client';

// One API read = one query key + one GET path. The SAME definition is used by the
// client hook (useApiQuery) and by server prefetching (lib/api/prefetch.tsx), so a
// page's first paint is hydrated with exactly the cache entry its components read
// (implementation-brief §4, "first paint has the data").
export interface ApiQueryDef<T, M extends object = Record<string, never>> {
  queryKey: readonly unknown[];
  path: string;
  // Phantom types so useApiQuery infers the envelope; never set at runtime.
  readonly _types?: { data: T; meta: M };
}

export function apiQuery<T, M extends object = Record<string, never>>(queryKey: readonly unknown[], path: string): ApiQueryDef<T, M> {
  return { queryKey, path };
}

export function useApiQuery<T, M extends object = Record<string, never>>(
  def: ApiQueryDef<T, M>,
  options: Omit<UseQueryOptions<ApiSuccess<T, M>>, 'queryKey' | 'queryFn'> = {},
) {
  return useQuery<ApiSuccess<T, M>>({ queryKey: def.queryKey, queryFn: () => api.get<T, M>(def.path), ...options });
}

// After a write: refetch every query whose key starts with `prefix`
// (e.g. ['loads'] refreshes the board, the detail pages and anything keyed under it).
export async function invalidate(queryClient: QueryClient, ...prefixes: (readonly unknown[])[]): Promise<void> {
  await Promise.all(prefixes.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

// The one `ui-empty` line a failed read adds (implementation-brief §4 rule 4): the API's
// user-safe message; nothing for a refusal (403), which renders like pending (rule 3).
export function queryErrorLine(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  if (error instanceof ApiError) return error.status === 403 ? null : error.message;
  return 'Something went wrong.';
}
