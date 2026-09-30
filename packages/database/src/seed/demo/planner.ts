import { addDaysIso } from '@runtruck/calculations';
import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../client.js';
import { organizations } from '../../schema/platform.js';
import { plannerColorCodes, plannerEvents } from '../../schema/planner.js';
import { must } from './refs.js';

// The shared calendar's defaults (docs/03-database.md §7.24, §7.25, §5.12.2). "Reset
// calendar" (D8) restores the organization's OWN defaults, chosen by
// `organizations.planner_defaults`:
// - every organization: the six color codes of Runtruck1 DEFAULT_CATEGORIES (organization-
//   neutral labels and tones);
// - only an organization whose set is 'runtruck1_demo' (the demo seed): also Runtruck1's
//   PLANNER_EVENTS, which name the demo tenant's staff, customers and invoices and must never
//   be written into another organization.
// The seed and POST /planner/reset share `insertPlannerDefaults`.

type ColorCode = typeof plannerColorCodes.$inferInsert;

type ColorCodeSeed = Pick<ColorCode, 'key' | 'label' | 'tone'> & { isLocked: boolean };

// In position order.
export const DEFAULT_COLOR_CODES: readonly ColorCodeSeed[] = [
  { key: 'pickup', label: 'Loaded (pickup)', tone: 'amber', isLocked: true },
  { key: 'delivery', label: 'Empty (delivery)', tone: 'green', isLocked: true },
  { key: 'maintenance', label: 'Maintenance', tone: 'red', isLocked: false },
  { key: 'driver', label: 'Driver schedule', tone: 'purple', isLocked: false },
  { key: 'meeting', label: 'Meetings', tone: 'blue', isLocked: false },
  { key: 'admin', label: 'Billing & admin', tone: 'teal', isLocked: false },
];

export interface PlannerEventSeed {
  title: string;
  colorCode: string;
  startDate: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
  people?: readonly string[];
}

// Weekdays from `from` to `to` inclusive, skipping `skip` (Runtruck1 weekdaysBetween).
function weekdaysBetween(from: string, to: string, skip: readonly string[]): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !skip.includes(d)) out.push(d);
  }
  return out;
}

// Runtruck1 STANDUPS: every weekday from Aug 24 to Sep 30, 2026, except Labor Day.
const STANDUPS: PlannerEventSeed[] = weekdaysBetween('2026-08-24', '2026-09-30', ['2026-09-07']).map((date) => ({
  title: 'Dispatch standup',
  colorCode: 'meeting',
  startDate: date,
  startTime: '08:00',
  endTime: '08:30',
  notes: 'Board review: uncovered loads, HOS, delays.',
  people: ['Rosa Medina', 'Luis Ortega', 'Evan Brooks'],
}));

// Runtruck1 PLANNER_EVENTS order: the standups, then ev-1 … ev-15 (verbatim, D6).
// Demo content: inserted only for the 'runtruck1_demo' default set.
export const DEMO_PLANNER_EVENTS: readonly PlannerEventSeed[] = [
  ...STANDUPS,
  { title: 'Tobias Frey — home time', colorCode: 'driver', startDate: '2026-09-01', endDate: '2026-09-06', notes: 'Back on duty Mon Sep 7.', people: ['Tobias Frey'] },
  { title: 'T-118 in shop — turbo', colorCode: 'maintenance', startDate: '2026-09-02', endDate: '2026-09-05', notes: 'Sunridge shop · Modesto. Parts from Valley Diesel & Turbo.' },
  { title: 'Payroll review — week of Sep 1', colorCode: 'admin', startDate: '2026-09-01', startTime: '10:00', endTime: '11:00', notes: 'Approve driver settlements before Friday.', people: ['Rosa Medina'] },
  { title: 'Invoice batch B-2034 review', colorCode: 'admin', startDate: '2026-09-02', startTime: '14:00', endTime: '15:00', people: ['Rosa Medina'] },
  { title: 'FB-12 DOT annual inspection', colorCode: 'maintenance', startDate: '2026-09-03', startTime: '13:00', endTime: '15:00', notes: 'Sunridge shop · Modesto.', people: ['Luis Ortega'] },
  { title: 'Road test — Sofia Nguyen', colorCode: 'driver', startDate: '2026-09-04', startTime: '10:00', endTime: '11:30', notes: 'In T-103. Luis Ortega evaluates.', people: ['Sofia Nguyen', 'Luis Ortega'] },
  { title: 'T-114 PM service A', colorCode: 'maintenance', startDate: '2026-09-05', startTime: '07:00', endTime: '09:00', notes: 'Due at 529,800 mi.', people: ['Luis Ortega'] },
  { title: 'Labor Day — office closed', colorCode: 'admin', startDate: '2026-09-07' },
  { title: 'Orientation — Jamal Reed', colorCode: 'driver', startDate: '2026-09-08', startTime: '09:00', endTime: '12:00', notes: 'Paperwork, ELD training, yard walk.', people: ['Jamal Reed', 'Rosa Medina'] },
  {
    title: 'Safety meeting — HOS refresher',
    colorCode: 'meeting',
    startDate: '2026-09-08',
    startTime: '13:00',
    endTime: '14:00',
    people: ['Rosa Medina', 'Marcus Hale', 'Dara Whitfield', 'Ellis Nakamura', 'Priya Raman', 'Ana Cortez'],
  },
  { title: 'Northgate Foods quarterly review', colorCode: 'meeting', startDate: '2026-09-09', startTime: '11:00', endTime: '12:00', notes: 'With Dana Ruiz. On-time 96%, lane pricing for Q4.', people: ['Rosa Medina', 'Dana Ruiz'] },
  { title: 'IFTA Q3 prep', colorCode: 'admin', startDate: '2026-09-10', startTime: '15:00', endTime: '16:00' },
  { title: 'Sierra Ag collections call', colorCode: 'admin', startDate: '2026-09-11', startTime: '09:30', endTime: '10:30', notes: 'INV-8836, 41 days past due.', people: ['Rosa Medina', 'Ben Okafor'] },
  { title: 'Marcus Hale — Clearinghouse query due', colorCode: 'driver', startDate: '2026-09-20', people: ['Marcus Hale'] },
  { title: 'Ana Cortez — MVR & annual review due', colorCode: 'driver', startDate: '2026-09-24', people: ['Ana Cortez'] },
];

// created_at of the demo events: one second apart in Runtruck1's PLANNER_EVENTS order
// (27 standups, then ev-1 … ev-15), ending at 2026-09-03T00:00Z, before the demo day. Office
// events are ordered by (created_at, start_date, start_time, id) (docs/api/planner.md §2.5), so
// the API returns them in Runtruck1's `all` order and events created later sort after them.
// Reset writes the same instants.
export const PLANNER_DEFAULTS_CREATED_FROM = Date.parse('2026-09-03T00:00:00Z') - DEMO_PLANNER_EVENTS.length * 1000;

export type PlannerDefaultSet = (typeof organizations.$inferSelect)['plannerDefaults'];

export interface PlannerDefaultsResult {
  // Color-code ids by key.
  colorCodeIds: Map<string, string>;
  colorCodeCount: number;
  eventCount: number;
}

// The six default color codes (§7.24), in position order. Returns their ids by key.
export async function insertDefaultColorCodes(db: DbExecutor, organizationId: string): Promise<Map<string, string>> {
  const codes = await db
    .insert(plannerColorCodes)
    .values(DEFAULT_COLOR_CODES.map((c, i) => ({ organizationId, ...c, position: i + 1 })))
    .returning({ key: plannerColorCodes.key, id: plannerColorCodes.id });
  return new Map(codes.map((c) => [c.key, c.id]));
}

// Runtruck1's 42 demo events (§7.25) for the demo organization. Rows carry no user.
export async function insertDemoPlannerEvents(db: DbExecutor, organizationId: string, colorCodeIds: Map<string, string>): Promise<number> {
  await db.insert(plannerEvents).values(
    DEMO_PLANNER_EVENTS.map((e, i) => ({
      organizationId,
      title: e.title,
      colorCodeId: must(colorCodeIds, e.colorCode, 'planner color code'),
      startDate: e.startDate,
      endDate: e.endDate ?? null,
      startTime: e.startTime ?? null,
      endTime: e.endTime ?? null,
      place: null,
      notes: e.notes ?? null,
      people: [...(e.people ?? [])],
      loadId: null,
      createdByUserId: null,
      createdAt: new Date(PLANNER_DEFAULTS_CREATED_FROM + i * 1000),
    })),
  );
  return DEMO_PLANNER_EVENTS.length;
}

// Inserts the organization's default calendar (seed and Reset calendar): the six color codes,
// plus the demo events when `organizations.planner_defaults` is 'runtruck1_demo'. The caller
// deletes the old rows first (Reset) and runs this in its transaction. Returns what it wrote,
// so Reset reports real counts.
export async function insertPlannerDefaults(db: DbExecutor, organizationId: string): Promise<PlannerDefaultsResult> {
  const [org] = await db.select({ set: organizations.plannerDefaults }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) throw new Error('insertPlannerDefaults: organization not found');
  const colorCodeIds = await insertDefaultColorCodes(db, organizationId);
  const eventCount = org.set === 'runtruck1_demo' ? await insertDemoPlannerEvents(db, organizationId, colorCodeIds) : 0;
  return { colorCodeIds, colorCodeCount: colorCodeIds.size, eventCount };
}
