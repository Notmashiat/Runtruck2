import { formatLoadNumber, type PlannerEventVm } from '@runtruck/calculations';
import type {
  PageMeta,
  PlannerColorCodeDeleteResultDto,
  PlannerColorCodeDto,
  PlannerColorCodesMeta,
  PlannerEventDeleteResultDto,
  PlannerEventDto,
  PlannerEventsMeta,
  PlannerRelatedLoadDto,
  PlannerResetResultDto,
  PlannerStopValuesDto,
  PlannerTone,
} from '@runtruck/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addDays, iso, startOfWeek } from '../dates';
import { api, ApiError, qs } from './client';
import { apiQuery, invalidate, useApiQuery } from './query';

// Planner reads and writes (docs/api/planner.md §7). Every key starts with 'planner', so New
// Load's invalidate(['planner']) refreshes stop events, related loads and stop values.

// ─── reads (§7.1) ────────────────────────────────────────────────────────────────────────

export const plannerEventsQuery = (from: string, to: string) =>
  apiQuery<PlannerEventDto[], PlannerEventsMeta>(['planner', 'events', from, to], `/planner/events${qs({ from, to })}`);

export const plannerColorCodesQuery = apiQuery<PlannerColorCodeDto[], PlannerColorCodesMeta>(
  ['planner', 'color-codes'],
  '/planner/color-codes',
);

export const plannerStopValuesQuery = apiQuery<PlannerStopValuesDto>(['planner', 'stop-values'], '/planner/stop-values');

// EventDialog "Related load" (planner.manage + loads.view; decision P2).
export const plannerRelatedLoadsQuery = apiQuery<PlannerRelatedLoadDto[], PageMeta>(['planner', 'related-loads'], '/planner/related-loads');

export type PlannerView = 'Day' | 'Week' | 'Month';

// The visible range the grid needs (§7.1): Day = the cursor; Week = 7 days from the week start,
// even with weekends hidden; Month = every day of Runtruck1's month grid loop, unfiltered.
export function plannerRange(view: PlannerView, cursor: Date, weekStart: number): { from: string; to: string } {
  if (view === 'Day') return { from: iso(cursor), to: iso(cursor) };
  if (view === 'Week') {
    const from = startOfWeek(cursor, weekStart);
    return { from: iso(from), to: iso(addDays(from, 6)) };
  }
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = startOfWeek(first, weekStart);
  let last = start;
  for (let w = start; w.getMonth() === first.getMonth() || w < first; w = addDays(w, 7)) last = w;
  return { from: iso(start), to: iso(addDays(last, 6)) };
}

// The calendar is shared: other members' changes appear when the window regains focus.
const SHARED = { refetchOnWindowFocus: true } as const;

// A read the member may not make is never sent: it stays pending, which renders exactly like
// a refusal (implementation-brief §4 rule 3).
export const usePlannerEvents = (range: { from: string; to: string }, enabled = true) =>
  useApiQuery(plannerEventsQuery(range.from, range.to), { enabled, ...SHARED });
export const usePlannerColorCodes = (enabled = true) => useApiQuery(plannerColorCodesQuery, { enabled, ...SHARED });
export const usePlannerStopValues = (enabled = true) => useApiQuery(plannerStopValuesQuery, { enabled, ...SHARED });
export const usePlannerRelatedLoads = (enabled = true) => useApiQuery(plannerRelatedLoadsQuery, { enabled });

// A failed or refused write shows the API message in window.alert (decision P7).
export function plannerWriteError(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong.';
}

// ─── writes (§7.5) ───────────────────────────────────────────────────────────────────────

// POST /planner/events and PATCH /planner/events/:id body (every field sent).
export interface PlannerEventBody {
  title: string;
  colorCodeId: string;
  date: string;
  endDate: string | null;
  start: string | null;
  end: string | null;
  place: string | null;
  notes: string | null;
  people: string[];
  loadId: string | null;
}

// The body built from what Runtruck1's EventDialog saves (§7.5). The dialog already trimmed
// the title, place and people and dropped an end date that is not after the date; a cleared
// "Starts" (start '') saves the event all-day (quirk B5). An unchanged link to a load that is
// no longer on the board keeps its id (P3).
export function toPlannerEventBody(
  saved: PlannerEventVm,
  codes: readonly { key: string; id: string }[],
  relatedLoads: readonly Pick<PlannerRelatedLoadDto, 'id' | 'loadNumber'>[],
): PlannerEventBody {
  const timed = Boolean(saved.start);
  return {
    title: saved.title,
    colorCodeId: codes.find((c) => c.key === saved.category)?.id ?? saved.colorCodeId ?? '',
    date: saved.date,
    endDate: saved.endDate ?? null,
    start: timed ? (saved.start ?? null) : null,
    end: timed ? (saved.end ?? null) : null,
    place: saved.place ?? null,
    notes: saved.notes ?? null,
    people: saved.people ?? [],
    loadId: saved.loadId ? (relatedLoads.find((l) => formatLoadNumber(l.loadNumber) === saved.loadId)?.id ?? saved.loadUuid ?? null) : null,
  };
}

const EVENT_WRITE_INVALIDATES: readonly (readonly unknown[])[] = [
  ['planner', 'events'],
  ['planner', 'color-codes'],
  ['planner', 'stop-values'],
];

// The mutations resolve once the affected queries have refetched, so a dialog closes onto a
// calendar that already shows the change (as Runtruck1's in-memory update did).
export function useSavePlannerEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: PlannerEventBody }) =>
      id === null ? api.post<PlannerEventDto>('/planner/events', body) : api.patch<PlannerEventDto>(`/planner/events/${id}`, body),
    onSuccess: () => invalidate(queryClient, ...EVENT_WRITE_INVALIDATES),
  });
}

export function useDeletePlannerEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<PlannerEventDeleteResultDto>(`/planner/events/${id}`),
    onSuccess: () => invalidate(queryClient, ...EVENT_WRITE_INVALIDATES),
  });
}

export function useAddColorCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PlannerColorCodeDto>('/planner/color-codes', {}),
    onSuccess: () => invalidate(queryClient, plannerColorCodesQuery.queryKey),
  });
}

export function useRecolorColorCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tone }: { id: string; tone: PlannerTone }) => patchColorCode(id, { tone }),
    onSuccess: () => invalidate(queryClient, plannerColorCodesQuery.queryKey),
  });
}

export function useDeleteColorCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<PlannerColorCodeDeleteResultDto>(`/planner/color-codes/${id}`),
    onSuccess: () => invalidate(queryClient, plannerColorCodesQuery.queryKey, ['planner', 'events']),
  });
}

export function useResetPlanner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PlannerResetResultDto>('/planner/reset', {}),
    onSuccess: () => invalidate(queryClient, ['planner']),
  });
}

// PATCH /planner/color-codes/:id. Renames are debounced by the page (decision P8), so it is a
// plain call rather than a mutation hook.
export function patchColorCode(id: string, body: { label?: string; tone?: PlannerTone }) {
  return api.patch<PlannerColorCodeDto>(`/planner/color-codes/${id}`, body);
}
