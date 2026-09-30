import { formatLoadNumber, parseLoadNumber } from '@runtruck/calculations';
import type { LoadDetail, LoadDetailMeta, LoadListItem, LoadListMeta } from '@runtruck/types';
import type { CreateLoadInput } from '@runtruck/validation';
import { keepPreviousData, useMutation } from '@tanstack/react-query';
import { api } from './client';
import { apiQuery, useApiQuery } from './query';

// Loads reads and writes (docs/api/loads.md §8). Every key starts with 'loads', so
// invalidate(['loads']) after a write refreshes the board, the detail pages and the
// Dashboard search rows that share the board query.

// The Loads board: one bounded page of every board load (01 §3, L2); the pills and the
// top-bar search filter it locally. The Dashboard search reads the same entry.
export const loadsBoardQuery = apiQuery<LoadListItem[], LoadListMeta>(['loads', 'board'], '/loads?view=all&limit=500');

// Runtruck1's `loads[0]` for the detail page's fallback (loads.md §8.2.1, D6).
export const firstBoardLoadQuery = apiQuery<LoadListItem[], LoadListMeta>(['loads', 'board', 'first'], '/loads?view=all&limit=1');

export const loadByNumberQuery = (loadNumber: number) =>
  apiQuery<LoadDetail, LoadDetailMeta>(['loads', 'by-number', loadNumber], `/loads/by-number/${loadNumber}`);

export const loadByIdQuery = (id: string) => apiQuery<LoadDetail, LoadDetailMeta>(['loads', 'detail', id], `/loads/${id}`);

// The /app/loads/:loadNumber segment counts only when it is exactly a formatted load
// number ("L-40218"); anything else — "l-40218", "L-040218", "40218", "L-0" — falls back to
// the first board load, as Runtruck1's `loads.find(l => l.id === id) ?? loads[0]` (§8.2.1,
// D6). Load numbers start at 1 (loadNumberParamSchema), so "L-0" never reaches the API,
// which would answer 400 instead of the 404 that triggers the fallback.
export function loadNumberFromParam(segment: string): number | null {
  let param = segment;
  try {
    param = decodeURIComponent(segment);
  } catch {
    // A malformed escape is simply not a load number.
  }
  const n = parseLoadNumber(param);
  return n !== null && n >= 1 && formatLoadNumber(n) === param ? n : null;
}

// A refetch keeps the previous rows on screen (implementation-brief §4 rule 2).
export const useLoadsBoard = (enabled = true) => useApiQuery(loadsBoardQuery, { enabled, placeholderData: keepPreviousData });

// POST /loads (§6). The caller merges 400 issues into New Load's sections (§8.3.4).
export function useCreateLoad() {
  return useMutation({ mutationFn: (body: CreateLoadInput) => api.post<LoadDetail, LoadDetailMeta>('/loads', body) });
}

// The query keys POST /loads and the uploads change (loads.md §8.3.4, dashboard.md §5.7,
// planner.md, fleet.md §8, customers.md §6).
export const LOAD_WRITE_INVALIDATES: readonly (readonly unknown[])[] = [['loads'], ['dashboard'], ['planner'], ['drivers'], ['customers']];
