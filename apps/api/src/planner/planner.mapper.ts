import type { PlannerColorCodeDto, PlannerEventDto, PlannerTone } from '@runtruck/types';
import type { PlannerEventCreateInput, PlannerEventUpdateInput } from '@runtruck/validation';

// Pure mapping and comparison rules of the planner module (docs/api/planner.md §2, §4, §5),
// kept free of Nest and SQL so they are unit-tested on their own.

// An office event row with its color-code key and related load number.
export interface OfficeEventRow {
  id: string;
  title: string;
  colorCodeId: string;
  colorCodeKey: string;
  startDate: string;
  endDate: string | null;
  // `time` columns come back as HH:MM:SS.
  startTime: string | null;
  endTime: string | null;
  place: string | null;
  notes: string | null;
  people: string[];
  loadId: string | null;
  loadNumber: number | null;
}

// A load-stop event row; the display strings are composed in SQL (§2.4) so that `q`
// filters exactly what the DTO carries.
export interface StopEventRow {
  id: string;
  loadId: string;
  loadNumber: number;
  colorCodeId: string;
  colorCodeKey: string;
  date: string;
  start: string;
  end: string;
  timezone: string;
  title: string;
  place: string;
  notes: string;
  facility: string;
  customer: string;
  driver: string;
  truck: string;
  commodity: string | null;
}

export interface ColorCodeRow {
  id: string;
  key: string;
  label: string;
  tone: PlannerTone;
  isLocked: boolean;
  eventCount: number;
}

// The database returns `time` as HH:MM:SS; the API sends HH:MM (§2.1).
export function hhmm(time: string): string;
export function hhmm(time: string | null): string | null;
export function hhmm(time: string | null): string | null {
  return time === null ? null : time.slice(0, 5);
}

// §4.1, office column. Office times are wall clock in the organization's zone.
export function officeEventDto(row: OfficeEventRow, timezone: string): PlannerEventDto {
  return {
    id: row.id,
    readOnly: false,
    title: row.title,
    colorCodeId: row.colorCodeId,
    colorCodeKey: row.colorCodeKey,
    date: row.startDate,
    endDate: row.endDate,
    start: hhmm(row.startTime),
    end: hhmm(row.endTime),
    timezone,
    place: row.place,
    notes: row.notes,
    people: row.people,
    loadId: row.loadId,
    loadNumber: row.loadNumber,
    facility: null,
    customer: null,
    driver: null,
    truck: null,
    commodity: null,
  };
}

// §4.1, load-stop column (§2.4). Stop times are wall clock in the stop's zone.
export function stopEventDto(row: StopEventRow): PlannerEventDto {
  return {
    id: row.id,
    readOnly: true,
    title: row.title,
    colorCodeId: row.colorCodeId,
    colorCodeKey: row.colorCodeKey,
    date: row.date,
    endDate: null,
    start: hhmm(row.start),
    end: hhmm(row.end),
    timezone: row.timezone,
    place: row.place,
    notes: row.notes,
    people: [row.driver],
    loadId: row.loadId,
    loadNumber: row.loadNumber,
    facility: row.facility,
    customer: row.customer,
    driver: row.driver,
    truck: row.truck,
    commodity: row.commodity,
  };
}

export function colorCodeDto(row: ColorCodeRow): PlannerColorCodeDto {
  return { id: row.id, key: row.key, label: row.label, tone: row.tone, locked: row.isLocked, eventCount: row.eventCount };
}

// ─── office event fields (audit rows, PATCH merge, no-op detection) ─────────────────────

// The editable fields of an office event, in the wire shape of plannerEventCreateSchema.
export type PlannerEventFields = PlannerEventCreateInput;

export const PLANNER_EVENT_FIELD_KEYS = [
  'title',
  'colorCodeId',
  'date',
  'endDate',
  'start',
  'end',
  'place',
  'notes',
  'people',
  'loadId',
] as const;

export type PlannerEventFieldKey = (typeof PLANNER_EVENT_FIELD_KEYS)[number];

// A stored planner_events row, as the repository reads it for update or delete.
export interface StoredEventRow {
  id: string;
  title: string;
  colorCodeId: string;
  startDate: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  place: string | null;
  notes: string | null;
  people: string[];
  loadId: string | null;
}

export function storedEventFields(row: StoredEventRow): PlannerEventFields {
  return {
    title: row.title,
    colorCodeId: row.colorCodeId,
    date: row.startDate,
    endDate: row.endDate,
    start: hhmm(row.startTime),
    end: hhmm(row.endTime),
    place: row.place,
    notes: row.notes,
    people: row.people,
    loadId: row.loadId,
  };
}

// §3.3 step 2: the patch overlaid on the stored values. The result is parsed again with
// plannerEventCreateSchema, so the pairwise rules hold for the merged event.
export function mergeEventPatch(stored: PlannerEventFields, patch: PlannerEventUpdateInput): Record<PlannerEventFieldKey, unknown> {
  const merged = {} as Record<PlannerEventFieldKey, unknown>;
  for (const key of PLANNER_EVENT_FIELD_KEYS) {
    const value = patch[key];
    merged[key] = value === undefined ? stored[key] : value;
  }
  return merged;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

// The fields whose value differs (in PLANNER_EVENT_FIELD_KEYS order); [] = a no-op save.
export function changedEventFields(before: PlannerEventFields, after: PlannerEventFields): PlannerEventFieldKey[] {
  return PLANNER_EVENT_FIELD_KEYS.filter((key) => !sameValue(before[key], after[key]));
}

export function pickFields<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = source[key];
  return out;
}

// The planner_events columns for a set of event fields.
export function eventColumns(fields: PlannerEventFields) {
  return {
    title: fields.title,
    colorCodeId: fields.colorCodeId,
    startDate: fields.date,
    endDate: fields.endDate,
    startTime: fields.start,
    endTime: fields.end,
    place: fields.place,
    notes: fields.notes,
    people: fields.people,
    loadId: fields.loadId,
  };
}

// ─── lists ──────────────────────────────────────────────────────────────────────────────

// `ILIKE` pattern for Runtruck1's case-insensitive substring match (§2.6): %, _ and the
// escape character itself are matched literally.
export function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// §3.1: `limit`/`offset` apply to the concatenated list, office events first. Each part
// was read with LIMIT offset + limit, so the page is always inside what was read.
export function concatPage<T>(office: readonly T[], stops: readonly T[], offset: number, limit: number): T[] {
  return [...office, ...stops].slice(offset, offset + limit);
}

// §3.6: the first add is position 7 with the defaults; an empty organization starts at 1.
export function nextPosition(positions: readonly number[]): number {
  return positions.length === 0 ? 1 : Math.max(...positions) + 1;
}

// §3.8 step 3: the first other unlocked code in list order (is_locked DESC, position, id),
// Runtruck1's `categories.find(c => !c.locked && c.key !== key)`.
export function fallbackColorCode<C extends { id: string; isLocked: boolean }>(ordered: readonly C[], deletedId: string): C | undefined {
  return ordered.find((c) => !c.isLocked && c.id !== deletedId);
}
