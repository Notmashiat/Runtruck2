import { PLANNER_TONES, type PlannerCategoryVm, type PlannerColorBy, type PlannerEventVm } from '@runtruck/calculations';

// The presentation half of Runtruck1 data/planner.ts (docs/reference/runtruck1/planner.md §3.1,
// §3.2): calendar view preferences, card fields and row heights. The business half (seed
// events, color codes, load-derived stop events, TODAY) now comes from the API (docs/01 D8).

// The colors a color code can use (classes t-<tone> in calendar.css).
export const TONES: readonly string[] = PLANNER_TONES;

// A color code: what one color means on the calendar (Runtruck1 `Category`, with its API id).
export type Category = PlannerCategoryVm;

// One calendar event in Runtruck1's shape (built from the API DTO by toPlannerEventVm).
export type PlannerEvent = PlannerEventVm;

// — calendar preferences (Customize) —

export type CalView = 'Day' | 'Week' | 'Month';
export type Density = 'Compact' | 'Comfortable' | 'Spacious';
export const ROW_H: Record<Density, number> = { Compact: 40, Comfortable: 56, Spacious: 76 };

// What colors the load board's stops: their stop type (the Loaded / Empty
// color codes), or one color per driver, customer or truck.
export type ColorBy = PlannerColorBy;

// What an event card can show on each of its lines.
export type CardField =
  'place' | 'title' | 'category' | 'time' | 'load' | 'driver' | 'truck' | 'customer' | 'facility' | 'commodity' | 'none';
export const CARD_FIELDS: [CardField, string][] = [
  ['place', 'City, state'],
  ['category', 'Color code name'],
  ['time', 'Time'],
  ['load', 'Load #'],
  ['driver', 'Driver'],
  ['truck', 'Truck / trailer'],
  ['customer', 'Customer'],
  ['facility', 'Facility'],
  ['commodity', 'Commodity'],
  ['title', 'Event title'],
  ['none', 'Nothing'],
];

export interface Prefs {
  view: CalView;
  weekStart: number;
  showWeekends: boolean;
  dayStart: number;
  dayEnd: number;
  density: Density;
  hour24: boolean;
  // Colour-code keys, or "<colorBy>:<value>" keys, that are switched off.
  hidden: string[];
  colorBy: ColorBy;
  // "<colorBy>:<value>" → tone, for colors the user picked by hand.
  valueTones: Record<string, string>;
  cardLines: CardField[];
}

export const DEFAULT_PREFS: Prefs = {
  view: 'Week',
  weekStart: 1,
  showWeekends: true,
  dayStart: 6,
  dayEnd: 20,
  density: 'Comfortable',
  hour24: false,
  hidden: [],
  colorBy: 'type',
  valueTones: {},
  cardLines: ['place', 'time', 'load'],
};

// The browser key of the view preferences (Runtruck1's, docs/api/planner.md §7.8).
export const PREFS_KEY = 'runtruck-planner-prefs';

// Runtruck1 PlannerPage `revivePrefs`: any stored object is merged over the defaults (B13, kept).
export function revivePrefs(raw: unknown): Prefs | null {
  return raw && typeof raw === 'object' ? { ...DEFAULT_PREFS, ...(raw as Partial<Prefs>) } : null;
}
