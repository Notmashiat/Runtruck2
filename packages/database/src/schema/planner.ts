import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgEnum, pgTable, text, time, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_columns.js';
import { tenantFk, tenantKey } from './_tenant.js';
import { loads } from './loads.js';
import { organizationId, users } from './platform.js';

// The shared organization calendar (D8): color codes and office events. Load-stop
// events are computed from load_stops, never stored. Specified in docs/03-database.md §5.12.

// CSS classes t-<tone> in calendar.css.
export const plannerTone = pgEnum('planner_tone', ['amber', 'green', 'red', 'purple', 'blue', 'teal', 'pink', 'orange', 'indigo', 'slate']);

export const plannerColorCodes = pgTable(
  'planner_color_codes',
  {
    id: id(),
    organizationId: organizationId(),
    // Stable key used by the web's view preferences: 'pickup', 'delivery', … or 'code-<uuid>'.
    key: text().notNull(),
    label: text().notNull(),
    tone: plannerTone().notNull(),
    // The load board's two codes (pickup, delivery): cannot be deleted, always listed first.
    isLocked: boolean().notNull().default(false),
    position: integer().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('planner_color_codes', t),
    uniqueIndex('planner_color_codes_org_key_uq').on(t.organizationId, t.key),
    index('planner_color_codes_org_position_idx').on(t.organizationId, t.position),
  ],
);

export const plannerEvents = pgTable(
  'planner_events',
  {
    id: id(),
    organizationId: organizationId(),
    title: text().notNull(),
    colorCodeId: uuid().notNull(),
    // Timed events: start_date + start/end time. All-day events: no times, optional
    // inclusive end_date. Times are wall clock in the organization's timezone.
    startDate: date({ mode: 'string' }).notNull(),
    endDate: date({ mode: 'string' }),
    startTime: time(),
    endTime: time(),
    place: text(),
    notes: text(),
    // Free-text attendee names, in entry order.
    people: text().array().notNull().default(sql`'{}'::text[]`),
    // EventDialog "Related load".
    loadId: uuid(),
    // Null for seeded and reset rows.
    createdByUserId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    tenantKey('planner_events', t),
    tenantFk('planner_events_color_code_fk', t.organizationId, t.colorCodeId, plannerColorCodes).onDelete('restrict'),
    tenantFk('planner_events_load_fk', t.organizationId, t.loadId, loads).onDelete('restrict'),
    index('planner_events_org_start_idx').on(t.organizationId, t.startDate),
    index('planner_events_org_color_code_idx').on(t.organizationId, t.colorCodeId),
    check(
      'planner_events_time_ck',
      sql`(${t.startTime} is null and ${t.endTime} is null)
        or (${t.startTime} is not null and ${t.endTime} is not null and ${t.endTime} > ${t.startTime} and ${t.endDate} is null)`,
    ),
    check('planner_events_end_date_ck', sql`${t.endDate} is null or ${t.endDate} > ${t.startDate}`),
    // An all-day event spans at most 366 days (the range query's lower bound, 03 §5.12.2).
    check('planner_events_span_ck', sql`${t.endDate} is null or ${t.endDate} - ${t.startDate} <= 366`),
  ],
);
