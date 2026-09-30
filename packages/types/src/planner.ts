// Planner wire types (the shared organization calendar, docs/01 D8).
// Specified in docs/api/planner.md; every field's source column is listed there (§4).

import type { PageMeta } from './api.js';

// planner_tone enum (docs/03-database.md §4.7), Runtruck1 TONES order; CSS class t-<tone>.
export type PlannerTone = 'amber' | 'green' | 'red' | 'purple' | 'blue' | 'teal' | 'pink' | 'orange' | 'indigo' | 'slate';

// One calendar event: an office event (planner_events, editable) or a load-stop
// event (derived from load_stops of a board load, readOnly: true).
export interface PlannerEventDto {
  // planner_events.id, or load_stops.id for a load-stop event.
  id: string;
  // true for load-stop events: shown, but changed on the load.
  readOnly: boolean;
  // Office: planner_events.title. Stop: "L-40218 · Fresno, CA".
  title: string;
  // planner_color_codes.id; stops use the organization's locked pickup/delivery code.
  colorCodeId: string;
  // planner_color_codes.key ('pickup', 'delivery', 'maintenance', … or 'code-<uuid>'):
  // Runtruck1's `category`, the key the browser's hidden[] preference stores.
  colorCodeKey: string;
  // YYYY-MM-DD. Office: start_date. Stop: appointment_date.
  date: string;
  // All-day office events only: inclusive last day, after `date`. Stops: null.
  endDate: string | null;
  // HH:MM wall clock in `timezone`; both null = all-day. Stops always have times.
  start: string | null;
  end: string | null;
  // IANA zone of start/end: the organization's for office events, the stop's for stops.
  timezone: string;
  // "City, ST". Office: place. Stop: the stop route label.
  place: string | null;
  // Office: notes (untrimmed). Stop: "<facility name> · <customer name>".
  notes: string | null;
  // Office: people in entry order ([] = none). Stop: [driver label] ("Unassigned" kept).
  people: string[];
  // Related load (office, may be archived) or the stop's load.
  loadId: string | null;
  // Its load_number (40218 → "L-40218" on the web).
  loadNumber: number | null;
  // Stop events only (null on office events):
  facility: string | null;
  customer: string | null;
  // Driver label ("Unassigned" when no driver).
  driver: string | null;
  // Unit label "T-114 / RF-88", or "" when the load has no unit ("—").
  truck: string | null;
  commodity: string | null;
}

// GET /planner/events meta: the page plus the requested range.
export interface PlannerEventsMeta extends PageMeta {
  from: string;
  to: string;
}

// DELETE /planner/events/:id
export interface PlannerEventDeleteResultDto {
  id: string;
}

// One color code (Customize › Color codes, the legend, EventDialog "Color code").
export interface PlannerColorCodeDto {
  id: string;
  key: string;
  label: string;
  tone: PlannerTone;
  // The load board's two codes: cannot be deleted or chosen for office events.
  locked: boolean;
  // Office events using this code, all dates (the delete confirmation's count).
  eventCount: number;
}

// GET /planner/color-codes meta.
export interface PlannerColorCodesMeta {
  total: number;
}

// DELETE /planner/color-codes/:id: where its events went.
export interface PlannerColorCodeDeleteResultDto {
  id: string;
  reassignedToColorCodeId: string;
  reassignedEventCount: number;
}

// GET /planner/stop-values: everything about load stops the page needs
// independently of the visible range.
export interface PlannerStopValuesDto {
  // Sorted distinct values over every board-load stop event (JS default sort);
  // a missing value is "Unassigned". Runtruck1's `values` per colour-by mode.
  driver: string[];
  customer: string[];
  truck: string[];
  // The Event-cards preview sample: the first pickup event of the first board
  // load, else the first office event, else null.
  sampleEvent: PlannerEventDto | null;
}

// GET /planner/related-loads: EventDialog "Related load" options.
export interface PlannerRelatedLoadDto {
  id: string;
  loadNumber: number;
  // "Fresno, CA → Reno, NV"
  route: string;
}

// POST /planner/reset: the organization's calendar after the reset.
export interface PlannerResetResultDto {
  eventCount: number;
  colorCodeCount: number;
}
