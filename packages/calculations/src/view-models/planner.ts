// planner view-model builders and label/tone maps: turn API DTOs into Runtruck1-shaped
// display rows. Shared by the web (rendering + live search) and the API (server-side q)
// so both match identically (docs/03-database.md §1.11). Specified in docs/api/planner.md.

import type { PlannerColorCodeDto, PlannerEventDto, PlannerRelatedLoadDto, PlannerTone } from '@runtruck/types';
import { formatLoadNumber } from '../format.js';

// Runtruck1 TONES (data/planner.ts), in order: the Customize palette order, the default
// value colors (index into it) and the order in which a new color code picks its tone.
export const PLANNER_TONES: readonly PlannerTone[] = [
  'amber',
  'green',
  'red',
  'purple',
  'blue',
  'teal',
  'pink',
  'orange',
  'indigo',
  'slate',
];

// Runtruck1's `PlannerEvent` (data/planner.ts), built from a PlannerEventDto (planner.md
// §7.2): same keys, a null DTO field is an absent key. `colorCodeId` and `loadUuid` are
// not Runtruck1 keys; they carry the API ids the writes need and are never searched.
export interface PlannerEventVm {
  id: string;
  title: string;
  // The color code key (Runtruck1 `category`), e.g. 'pickup', 'meeting', 'code-<uuid>'.
  category: string;
  date: string;
  endDate?: string;
  start?: string;
  end?: string;
  place?: string;
  notes?: string;
  people?: string[];
  // Formatted load number, "L-40218".
  loadId?: string;
  facility?: string;
  customer?: string;
  driver?: string;
  truck?: string;
  commodity?: string;
  readOnly?: boolean;
  colorCodeId?: string;
  loadUuid?: string;
}

export function toPlannerEventVm(dto: PlannerEventDto): PlannerEventVm {
  const vm: PlannerEventVm = { id: dto.id, title: dto.title, category: dto.colorCodeKey, date: dto.date, people: dto.people };
  if (dto.endDate !== null) vm.endDate = dto.endDate;
  if (dto.start !== null) vm.start = dto.start;
  if (dto.end !== null) vm.end = dto.end;
  if (dto.place !== null) vm.place = dto.place;
  if (dto.notes !== null) vm.notes = dto.notes;
  if (dto.loadNumber !== null) vm.loadId = formatLoadNumber(dto.loadNumber);
  if (dto.facility !== null) vm.facility = dto.facility;
  if (dto.customer !== null) vm.customer = dto.customer;
  if (dto.driver !== null) vm.driver = dto.driver;
  // '' is kept: Runtruck1's `l.unit === '—' ? '' : l.unit`.
  if (dto.truck !== null) vm.truck = dto.truck;
  if (dto.commodity !== null) vm.commodity = dto.commodity;
  if (dto.readOnly) vm.readOnly = true;
  vm.colorCodeId = dto.colorCodeId;
  if (dto.loadId !== null) vm.loadUuid = dto.loadId;
  return vm;
}

// The object Runtruck1's planner hands to matchesQuery (planner.md §2.6, §7.4): nothing
// else is searched, so the load number only matches through the stop title, the facility
// through the notes, the driver through `people`, and the commodity never.
export interface PlannerSearchRow {
  title: string;
  place: string | undefined;
  notes: string | undefined;
  people: string | undefined;
  customer: string | undefined;
  truck: string | undefined;
}

export function plannerSearchRow(ev: PlannerEventVm): PlannerSearchRow {
  return { title: ev.title, place: ev.place, notes: ev.notes, people: ev.people?.join(' '), customer: ev.customer, truck: ev.truck };
}

// Runtruck1's matchesQuery over the planner search row.
export function plannerEventMatches(ev: PlannerEventVm, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return Object.values(plannerSearchRow(ev)).some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
}

// Runtruck1's `Category` (a color code), with the API id and office-event count alongside.
export interface PlannerCategoryVm {
  key: string;
  label: string;
  tone: PlannerTone;
  locked: boolean;
  id: string;
  eventCount: number;
}

export function toPlannerCategory(code: PlannerColorCodeDto): PlannerCategoryVm {
  return { key: code.key, label: code.label, tone: code.tone, locked: code.locked, id: code.id, eventCount: code.eventCount };
}

// "Color load stops by" modes (Runtruck1 ColorBy).
export type PlannerColorBy = 'type' | 'driver' | 'customer' | 'truck';

type StopValueSource = Pick<PlannerEventVm, 'driver' | 'customer' | 'truck'>;

// Runtruck1 `valueOf`: the stop's driver / customer / truck, "Unassigned" when empty.
export function plannerValueOf(ev: StopValueSource, by: PlannerColorBy): string {
  const v = by === 'driver' ? ev.driver : by === 'customer' ? ev.customer : by === 'truck' ? ev.truck : '';
  return v && v !== 'Unassigned' ? v : 'Unassigned';
}

// Runtruck1 `values`: distinct values over the load-stop events, sorted with JavaScript's
// default sort (UTF-16 code units), as GET /planner/stop-values returns them (§3.9).
export function plannerStopValues(events: readonly StopValueSource[], by: Exclude<PlannerColorBy, 'type'>): string[] {
  return [...new Set(events.map((e) => plannerValueOf(e, by)))].sort();
}

// Runtruck1 `addCategory`: the first tone no code uses, else slate (quirk B15).
export function firstUnusedPlannerTone(usedTones: Iterable<string>): PlannerTone {
  const used = new Set(usedTones);
  return PLANNER_TONES.find((t) => !used.has(t)) ?? 'slate';
}

// EventDialog "Related load" option text: "L-40218 · Fresno, CA → Reno, NV".
export function plannerRelatedLoadText(load: Pick<PlannerRelatedLoadDto, 'loadNumber' | 'route'>): string {
  return `${formatLoadNumber(load.loadNumber)} · ${load.route}`;
}

// The Customize › Color codes delete confirmation (Runtruck1 PlannerPage deleteCategory).
export function plannerDeleteCodeConfirm(label: string, eventCount: number, fallbackLabel: string): string {
  return `Delete “${label}”? Its ${eventCount} event${eventCount === 1 ? '' : 's'} move to “${fallbackLabel}”.`;
}
