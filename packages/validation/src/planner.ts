import { z } from 'zod';
import { businessDateSchema, pageQuerySchema } from './common.js';

// Planner input schemas (the shared organization calendar, docs/01 D8).
// Specified in docs/api/planner.md; the API parses every body and query with
// these, and the web mirrors the same rules in the EventDialog.

// ─── shared field schemas ────────────────────────────────────────────────

// Runtruck1's TONES, in order: the palette order and the order in which
// POST /planner/color-codes picks the first unused tone (docs/api/planner.md §3.6).
export const plannerToneSchema = z.enum(['amber', 'green', 'red', 'purple', 'blue', 'teal', 'pink', 'orange', 'indigo', 'slate']);
export type PlannerToneInput = z.output<typeof plannerToneSchema>;

// A real calendar day within the business-date bounds (common.ts): Postgres would refuse
// 2026-02-31 or year 0 with a 500.
const plannerDateSchema = businessDateSchema;

// Wall-clock HH:MM (24 h), organization timezone for office events.
const plannerTimeSchema = z.iso.time({ precision: -1, error: 'Use a HH:MM time.' });

// Runtruck1 trims the title on save and requires it.
const plannerTitleSchema = z.string().trim().min(1, 'Enter a title.').max(200, 'Use at most 200 characters.');

// "City, state": trimmed; blank becomes null (Runtruck1 `place?.trim() || undefined`).
const plannerPlaceSchema = z
  .string()
  .max(120, 'Use at most 120 characters.')
  .nullable()
  .transform((v) => {
    const t = v?.trim() ?? '';
    return t === '' ? null : t;
  });

// Notes are NOT trimmed (Runtruck1 B6, reproduced per D6); an empty string becomes null.
const plannerNotesSchema = z
  .string()
  .max(2000, 'Use at most 2,000 characters.')
  .nullable()
  .transform((v) => (v === '' ? null : v));

// Free-text attendee names, in entry order: trimmed, blanks dropped (Runtruck1 save).
const plannerPeopleSchema = z
  .array(z.string().max(100, 'Use at most 100 characters per name.'))
  .max(50, 'List at most 50 people.')
  .transform((list) => list.map((p) => p.trim()).filter((p) => p !== ''));

const plannerColorCodeIdSchema = z.uuid('Choose one of your color codes.');
const plannerLoadIdSchema = z.uuid('Choose a load from the board.');

// Whole days from one YYYY-MM-DD date to another (UTC arithmetic, no local Date).
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// Longest all-day event: its inclusive end date is at most this many days after its start.
// Bounds the calendar range query from below (docs/api/planner.md §3.1) and is mirrored by
// the CHECK planner_events_span_ck (docs/03-database.md §5.12.2).
export const PLANNER_MAX_EVENT_SPAN_DAYS = 366;

interface EventShape {
  date: string;
  endDate: string | null;
  start: string | null;
  end: string | null;
}

// Timed events have both times (end after start) and no end date; all-day events
// have neither time and an optional inclusive end date on or after the start date.
// Messages for end/endDate are Runtruck1's EventDialog texts.
function checkEventShape(e: EventShape, ctx: z.RefinementCtx): void {
  const timed = e.start !== null || e.end !== null;
  if (e.start === null && e.end !== null) {
    ctx.addIssue({ code: 'custom', path: ['start'], message: 'Enter a start and an end time, or make the event all day.' });
  } else if (e.start !== null && e.end === null) {
    ctx.addIssue({ code: 'custom', path: ['end'], message: 'Enter a start and an end time, or make the event all day.' });
  } else if (e.start !== null && e.end !== null && e.end <= e.start) {
    ctx.addIssue({ code: 'custom', path: ['end'], message: 'Must be after the start' });
  }
  if (e.endDate !== null) {
    if (timed) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Only all-day events can span several days.' });
    } else if (e.endDate < e.date) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Must be on or after the start date' });
    } else if (daysBetween(e.date, e.endDate) > PLANNER_MAX_EVENT_SPAN_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'An event spans at most a year.' });
    }
  }
}

// ─── planner events ──────────────────────────────────────────────────────

// POST /planner/events. Also used by the service to validate the merged row of
// a PATCH (stored values overlaid with the patch), so both paths share one rule set.
// Normalization: an end date equal to the start date is dropped (Runtruck1 save).
export const plannerEventCreateSchema = z
  .strictObject({
    title: plannerTitleSchema,
    colorCodeId: plannerColorCodeIdSchema,
    date: plannerDateSchema,
    endDate: plannerDateSchema.nullable().default(null),
    start: plannerTimeSchema.nullable().default(null),
    end: plannerTimeSchema.nullable().default(null),
    place: plannerPlaceSchema.default(null),
    notes: plannerNotesSchema.default(null),
    people: plannerPeopleSchema.default([]),
    loadId: plannerLoadIdSchema.nullable().default(null),
  })
  .superRefine(checkEventShape)
  .transform((e) => ({ ...e, endDate: e.endDate === e.date ? null : e.endDate }));

export type PlannerEventCreateInput = z.output<typeof plannerEventCreateSchema>;

// PATCH /planner/events/:id. Every field optional, at least one present. Pairwise
// rules are checked on the merged row with plannerEventCreateSchema (see above).
export const plannerEventUpdateSchema = z
  .strictObject({
    title: plannerTitleSchema.optional(),
    colorCodeId: plannerColorCodeIdSchema.optional(),
    date: plannerDateSchema.optional(),
    endDate: plannerDateSchema.nullable().optional(),
    start: plannerTimeSchema.nullable().optional(),
    end: plannerTimeSchema.nullable().optional(),
    place: plannerPlaceSchema.optional(),
    notes: plannerNotesSchema.optional(),
    people: plannerPeopleSchema.optional(),
    loadId: plannerLoadIdSchema.nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'Change at least one field.');

export type PlannerEventUpdateInput = z.output<typeof plannerEventUpdateSchema>;

// Longest range GET /planner/events serves: a Month grid is at most 6 weeks.
const PLANNER_MAX_RANGE_DAYS = 42;

// GET /planner/events?from=&to=  (inclusive business days; q/limit/offset per docs/04-api.md §5).
export const plannerEventsQuerySchema = pageQuerySchema
  .extend({
    from: plannerDateSchema,
    to: plannerDateSchema,
    // The calendar needs every event of the range, so the default is the ceiling.
    limit: z.coerce.number().int().min(1).max(500).default(500),
  })
  .superRefine((r, ctx) => {
    if (r.to < r.from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Must be on or after from.' });
    } else if (daysBetween(r.from, r.to) >= PLANNER_MAX_RANGE_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'A range covers at most 42 days.' });
    }
  });

export type PlannerEventsQuery = z.output<typeof plannerEventsQuerySchema>;

// ─── color codes ─────────────────────────────────────────────────────────

// Stored as typed (Runtruck1 does not trim); blank or whitespace-only becomes
// "Untitled" (Runtruck1's onBlur rule, enforced server-side).
const plannerColorCodeLabelSchema = z
  .string()
  .max(80, 'Use at most 80 characters.')
  .transform((v) => (v.trim() === '' ? 'Untitled' : v));

// POST /planner/color-codes. The web sends {}; the server then uses the label
// "New color code" and the first tone no code uses (else slate).
export const plannerColorCodeCreateSchema = z.strictObject({
  label: plannerColorCodeLabelSchema.optional(),
  tone: plannerToneSchema.optional(),
});

export type PlannerColorCodeCreateInput = z.output<typeof plannerColorCodeCreateSchema>;

// PATCH /planner/color-codes/:id. Locked codes may be renamed and recoloured too.
export const plannerColorCodeUpdateSchema = z
  .strictObject({
    label: plannerColorCodeLabelSchema.optional(),
    tone: plannerToneSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'Change at least one field.');

export type PlannerColorCodeUpdateInput = z.output<typeof plannerColorCodeUpdateSchema>;

// ─── lookups and reset ───────────────────────────────────────────────────

// GET /planner/related-loads (EventDialog "Related load"); board loads are few,
// so one page of up to 500 covers them.
export const plannerRelatedLoadsQuerySchema = pageQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(500).default(500),
});

export type PlannerRelatedLoadsQuery = z.output<typeof plannerRelatedLoadsQuerySchema>;

// POST /planner/reset takes no input; the empty strict object rejects stray fields.
export const plannerResetSchema = z.strictObject({});

export type PlannerResetInput = z.output<typeof plannerResetSchema>;
