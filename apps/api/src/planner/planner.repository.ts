import { Inject, Injectable } from '@nestjs/common';
import { type Database, type DbExecutor, schema } from '@runtruck/database';
import type { PlannerTone } from '@runtruck/types';
import { and, asc, between, count, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, type SQL, sql } from 'drizzle-orm';
import type { PgSelect } from 'drizzle-orm/pg-core';
import { DB } from '../database/database.module.js';
import type { ColorCodeRow, OfficeEventRow, StopEventRow, StoredEventRow } from './planner.mapper.js';

const {
  customers,
  dispatches,
  drivers,
  employees,
  facilities,
  loads,
  loadStops,
  organizations,
  plannerColorCodes: codes,
  plannerEvents: events,
  trailers,
  trucks,
} = schema;

// ─── office events ──────────────────────────────────────────────────────────────────────

const officeColumns = {
  id: events.id,
  title: events.title,
  colorCodeId: events.colorCodeId,
  colorCodeKey: codes.key,
  startDate: events.startDate,
  endDate: events.endDate,
  startTime: events.startTime,
  endTime: events.endTime,
  place: events.place,
  notes: events.notes,
  people: events.people,
  loadId: events.loadId,
  loadNumber: loads.loadNumber,
};

// Joins carry organization_id equality on both sides (docs/api/planner.md §2.2).
const officeCodeJoin = and(eq(codes.organizationId, events.organizationId), eq(codes.id, events.colorCodeId));
const officeLoadJoin = and(eq(loads.organizationId, events.organizationId), eq(loads.id, events.loadId));

// §2.5 office order: created_at, start_date, start_time NULLS FIRST, id.
const officeOrder = [asc(events.createdAt), asc(events.startDate), sql`${events.startTime} asc nulls first`, asc(events.id)];

// §2.6 over Runtruck1's search object { title, place, notes, people }; customer and truck
// are absent on office events.
function officeQueryFilter(pattern: string): SQL | undefined {
  return or(
    ilike(events.title, pattern),
    ilike(events.place, pattern),
    ilike(events.notes, pattern),
    sql`array_to_string(${events.people}, ' ') ilike ${pattern}`,
  );
}

// ─── load-stop events (§2.4) ────────────────────────────────────────────────────────────

// Stop route label (03 §6.0.3): the facility market, else the typed city.
const stopPlace = sql<string>`(case when ${facilities.id} is not null
  then coalesce(${facilities.marketCity}, ${facilities.city}) || ', ' || coalesce(${facilities.marketState}, ${facilities.state})
  else ${loadStops.city} || ', ' || ${loadStops.state} end)`;
const stopTitle = sql<string>`('L-' || ${loads.loadNumber} || ' · ' || ${stopPlace})`;
const stopNotes = sql<string>`(${loadStops.facilityName} || ' · ' || ${customers.name})`;
// Driver label: the live dispatch's own driver, else the partner's free-text driver, else "Unassigned".
const stopDriver = sql<string>`coalesce(${employees.firstName} || ' ' || ${employees.lastName}, nullif(${dispatches.driverName}, ''), 'Unassigned')`;
// Unit label: truck and trailer joined " / "; '' when neither (Runtruck1 `l.unit === '—' ? '' : l.unit`).
const stopTruck = sql<string>`concat_ws(' / ', nullif(coalesce(${trucks.unitNumber}, ${dispatches.truckNumber}), ''), nullif(coalesce(${trailers.unitNumber}, ${dispatches.trailerNumber}), ''))`;
// Planned slot, else the window when both ends are set, else 08:00–09:00 (Runtruck1 B4).
const stopStart = sql<string>`(case when ${loadStops.plannedStart} is not null then ${loadStops.plannedStart}
  when ${loadStops.windowOpen} is not null and ${loadStops.windowClose} is not null then ${loadStops.windowOpen}
  else time '08:00' end)`;
const stopEnd = sql<string>`(case when ${loadStops.plannedStart} is not null then ${loadStops.plannedEnd}
  when ${loadStops.windowOpen} is not null and ${loadStops.windowClose} is not null then ${loadStops.windowClose}
  else time '09:00' end)`;

const stopColumns = {
  id: loadStops.id,
  loadId: loads.id,
  loadNumber: loads.loadNumber,
  colorCodeId: codes.id,
  colorCodeKey: codes.key,
  date: loadStops.appointmentDate,
  start: stopStart,
  end: stopEnd,
  timezone: loadStops.timezone,
  title: stopTitle,
  place: stopPlace,
  notes: stopNotes,
  facility: loadStops.facilityName,
  customer: customers.name,
  driver: stopDriver,
  truck: stopTruck,
  commodity: loads.commodity,
};

// §2.6 over { title, place, notes, people: [driver], customer, truck }.
function stopQueryFilter(pattern: string): SQL | undefined {
  return or(
    ilike(stopTitle, pattern),
    ilike(stopPlace, pattern),
    ilike(stopNotes, pattern),
    ilike(stopDriver, pattern),
    ilike(customers.name, pattern),
    ilike(stopTruck, pattern),
  );
}

// §2.5 stop order: board order, then stop sequence.
const stopOrder = [desc(loads.createdAt), desc(loads.loadNumber), asc(loadStops.sequence)];

export interface StopEventFilter {
  from?: string;
  to?: string;
  kind?: 'pickup';
  pattern?: string;
}

export interface RangeFilter {
  from: string;
  to: string;
  // from − 366 days: an all-day event spans at most 366 days, so this bound is exact (§3.1).
  earliestStart: string;
  pattern?: string;
}

export interface Page<T> {
  rows: T[];
  // count(*) over () of the filter; 0 when nothing matches.
  total: number;
}

const total = sql<number>`count(*) over ()`.mapWith(Number);

// Reads and writes of the planner module. Every method takes the session's organization
// and filters every tenant table (and every join) on it (docs/api/planner.md §2.2).
@Injectable()
export class PlannerRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  get database(): Database {
    return this.db;
  }

  // ─── events ───────────────────────────────────────────────────────────────────────────

  // §3.1 statement 1: office events overlapping the range (index planner_events_org_start_idx).
  async officeEvents(organizationId: string, range: RangeFilter, take: number): Promise<Page<OfficeEventRow>> {
    const filters: (SQL | undefined)[] = [
      eq(events.organizationId, organizationId),
      lte(events.startDate, range.to),
      gte(events.startDate, range.earliestStart),
      sql`coalesce(${events.endDate}, ${events.startDate}) >= ${range.from}`,
    ];
    if (range.pattern) filters.push(officeQueryFilter(range.pattern));
    const rows = await this.db
      .select({ ...officeColumns, total })
      .from(events)
      .innerJoin(codes, officeCodeJoin)
      .leftJoin(loads, officeLoadJoin)
      .where(and(...filters))
      .orderBy(...officeOrder)
      .limit(take);
    return { rows: rows.map(({ total: _t, ...row }) => row), total: rows[0]?.total ?? 0 };
  }

  // The first office event in §2.5 order (the Event-cards sample without a pickup, §3.9).
  async firstOfficeEvent(organizationId: string): Promise<OfficeEventRow | null> {
    const [row] = await this.db
      .select(officeColumns)
      .from(events)
      .innerJoin(codes, officeCodeJoin)
      .leftJoin(loads, officeLoadJoin)
      .where(eq(events.organizationId, organizationId))
      .orderBy(...officeOrder)
      .limit(1);
    return row ?? null;
  }

  async officeEventById(db: DbExecutor, organizationId: string, id: string): Promise<OfficeEventRow | null> {
    const [row] = await db
      .select(officeColumns)
      .from(events)
      .innerJoin(codes, officeCodeJoin)
      .leftJoin(loads, officeLoadJoin)
      .where(and(eq(events.organizationId, organizationId), eq(events.id, id)))
      .limit(1);
    return row ?? null;
  }

  // §3.1 statement 2 / §3.9: load-stop events of board loads (index load_stops_org_date_idx
  // when a range is given).
  async stopEvents(organizationId: string, filter: StopEventFilter, take: number): Promise<Page<StopEventRow>> {
    const rows = await this.stopEventQuery(organizationId, filter)
      .orderBy(...stopOrder)
      .limit(take);
    return { rows: rows.map(({ total: _t, ...row }) => row), total: rows[0]?.total ?? 0 };
  }

  // §3.9 Event-cards sample: the first pickup stop event in §2.5 order. A plain ORDER BY …
  // LIMIT 1 (no window count): board loads in loads_org_board_idx order, each load's stops
  // by sequence, so it reads the first board loads only.
  async firstPickupEvent(organizationId: string): Promise<StopEventRow | null> {
    const query = this.db.select(stopColumns).from(loadStops).$dynamic();
    const [row] = await withStopJoins(query)
      .where(this.stopWhere(organizationId, { kind: 'pickup' }))
      .orderBy(...stopOrder)
      .limit(1);
    return row ?? null;
  }

  // §3.9: the distinct (driver, customer, truck) labels over every board-load stop event.
  // The three labels belong to the load (its customer and live dispatch), not to the stop, so
  // this reads one row per board load that has a pickup or delivery stop event (EXISTS over
  // its own stops, with the locked code the §2.4 join requires), never every stop.
  async stopValueRows(organizationId: string): Promise<{ driver: string; customer: string; truck: string }[]> {
    const hasStopEvent = sql`exists (select 1 from ${loadStops}
      join ${codes} on ${codes.organizationId} = ${loadStops.organizationId} and ${codes.key} = ${loadStops.kind}::text
      where ${loadStops.organizationId} = ${loads.organizationId} and ${loadStops.loadId} = ${loads.id}
        and ${loadStops.kind} in ('pickup', 'delivery'))`;
    return withLoadLabelJoins(
      this.db.selectDistinct({ driver: stopDriver, customer: customers.name, truck: stopTruck }).from(loads).$dynamic(),
    ).where(and(eq(loads.organizationId, organizationId), isNull(loads.archivedAt), hasStopEvent));
  }

  private stopEventQuery(organizationId: string, filter: StopEventFilter) {
    const query = this.db
      .select({ ...stopColumns, total })
      .from(loadStops)
      .$dynamic();
    return withStopJoins(query).where(this.stopWhere(organizationId, filter));
  }

  private stopWhere(organizationId: string, filter: StopEventFilter): SQL | undefined {
    const filters: (SQL | undefined)[] = [eq(loadStops.organizationId, organizationId)];
    filters.push(filter.kind ? eq(loadStops.kind, filter.kind) : inArray(loadStops.kind, ['pickup', 'delivery']));
    if (filter.from !== undefined && filter.to !== undefined) filters.push(between(loadStops.appointmentDate, filter.from, filter.to));
    if (filter.pattern) filters.push(stopQueryFilter(filter.pattern));
    return and(...filters);
  }

  // ─── event writes (inside a transaction) ──────────────────────────────────────────────

  // §3.2 step 1: the code, share-locked so a concurrent delete or Reset waits.
  async colorCodeForShare(
    tx: DbExecutor,
    organizationId: string,
    id: string,
  ): Promise<{ id: string; key: string; isLocked: boolean } | null> {
    const [row] = await tx
      .select({ id: codes.id, key: codes.key, isLocked: codes.isLocked })
      .from(codes)
      .where(and(eq(codes.organizationId, organizationId), eq(codes.id, id)))
      .for('share');
    return row ?? null;
  }

  // §3.2 step 2: a board load of the organization.
  async boardLoad(tx: DbExecutor, organizationId: string, id: string): Promise<{ id: string; loadNumber: number } | null> {
    const [row] = await tx
      .select({ id: loads.id, loadNumber: loads.loadNumber })
      .from(loads)
      .where(and(eq(loads.organizationId, organizationId), eq(loads.id, id), isNull(loads.archivedAt)))
      .limit(1);
    return row ?? null;
  }

  async insertEvent(tx: DbExecutor, values: typeof events.$inferInsert): Promise<string> {
    const [row] = await tx.insert(events).values(values).returning({ id: events.id });
    if (!row) throw new Error('planner event insert returned nothing');
    return row.id;
  }

  async eventForUpdate(tx: DbExecutor, organizationId: string, id: string): Promise<StoredEventRow | null> {
    const [row] = await tx
      .select(storedColumns)
      .from(events)
      .where(and(eq(events.organizationId, organizationId), eq(events.id, id)))
      .for('update');
    return row ?? null;
  }

  async updateEvent(tx: DbExecutor, organizationId: string, id: string, values: Partial<typeof events.$inferInsert>): Promise<void> {
    await tx
      .update(events)
      .set(values)
      .where(and(eq(events.organizationId, organizationId), eq(events.id, id)));
  }

  async deleteEvent(tx: DbExecutor, organizationId: string, id: string): Promise<StoredEventRow | null> {
    const [row] = await tx
      .delete(events)
      .where(and(eq(events.organizationId, organizationId), eq(events.id, id)))
      .returning(storedColumns);
    return row ?? null;
  }

  // ─── color codes ──────────────────────────────────────────────────────────────────────

  // §3.5: every code with its office-event count (index planner_events_org_color_code_idx).
  async colorCodes(db: DbExecutor, organizationId: string, id?: string): Promise<ColorCodeRow[]> {
    return db
      .select({
        id: codes.id,
        key: codes.key,
        label: codes.label,
        tone: codes.tone,
        isLocked: codes.isLocked,
        eventCount: count(events.id),
      })
      .from(codes)
      .leftJoin(events, and(eq(events.organizationId, codes.organizationId), eq(events.colorCodeId, codes.id)))
      .where(and(eq(codes.organizationId, organizationId), id === undefined ? undefined : eq(codes.id, id)))
      .groupBy(codes.id)
      .orderBy(desc(codes.isLocked), asc(codes.position), asc(codes.id));
  }

  // Every code of the organization in list order, row-locked (§3.6, §3.8 step 1, §3.11 step 1).
  // It first takes the organization's color-code-set lock, a transaction-scoped advisory
  // lock, so create, delete and reset run one at a time per organization. Row locks alone
  // do not serialize them: under READ COMMITTED a waiting `SELECT … FOR UPDATE` re-checks
  // only the rows of its own snapshot and never sees a code a concurrent add inserted, so
  // the 100-code limit, max(position) + 1 and the first unused tone would read stale data.
  // The SELECT below is a new statement, so after the lock it sees every committed code.
  async colorCodesForUpdate(tx: DbExecutor, organizationId: string): Promise<LockedColorCode[]> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`planner_color_codes:${organizationId}`}, 0))`);
    return tx
      .select({ id: codes.id, key: codes.key, label: codes.label, tone: codes.tone, isLocked: codes.isLocked, position: codes.position })
      .from(codes)
      .where(eq(codes.organizationId, organizationId))
      .orderBy(desc(codes.isLocked), asc(codes.position), asc(codes.id))
      .for('update');
  }

  async colorCodeForUpdate(tx: DbExecutor, organizationId: string, id: string): Promise<LockedColorCode | null> {
    const [row] = await tx
      .select({ id: codes.id, key: codes.key, label: codes.label, tone: codes.tone, isLocked: codes.isLocked, position: codes.position })
      .from(codes)
      .where(and(eq(codes.organizationId, organizationId), eq(codes.id, id)))
      .for('update');
    return row ?? null;
  }

  async insertColorCode(tx: DbExecutor, values: typeof codes.$inferInsert): Promise<void> {
    await tx.insert(codes).values(values);
  }

  async updateColorCode(tx: DbExecutor, organizationId: string, id: string, values: { label?: string; tone?: PlannerTone }): Promise<void> {
    await tx
      .update(codes)
      .set(values)
      .where(and(eq(codes.organizationId, organizationId), eq(codes.id, id)));
  }

  // §3.8 step 4: moves the code's events to the fallback; returns how many moved.
  async reassignEvents(tx: DbExecutor, organizationId: string, fromId: string, toId: string): Promise<number> {
    const result = await tx
      .update(events)
      .set({ colorCodeId: toId })
      .where(and(eq(events.organizationId, organizationId), eq(events.colorCodeId, fromId)));
    return result.rowCount ?? 0;
  }

  async deleteColorCode(tx: DbExecutor, organizationId: string, id: string): Promise<void> {
    await tx.delete(codes).where(and(eq(codes.organizationId, organizationId), eq(codes.id, id)));
  }

  // ─── reset ────────────────────────────────────────────────────────────────────────────

  async calendarCounts(tx: DbExecutor, organizationId: string): Promise<{ eventCount: number; colorCodeCount: number }> {
    const [e] = await tx.select({ n: count() }).from(events).where(eq(events.organizationId, organizationId));
    const [c] = await tx.select({ n: count() }).from(codes).where(eq(codes.organizationId, organizationId));
    return { eventCount: e?.n ?? 0, colorCodeCount: c?.n ?? 0 };
  }

  async deleteCalendar(tx: DbExecutor, organizationId: string): Promise<void> {
    await tx.delete(events).where(eq(events.organizationId, organizationId));
    await tx.delete(codes).where(eq(codes.organizationId, organizationId));
  }

  async organizationName(tx: DbExecutor, organizationId: string): Promise<string> {
    const [row] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    return row?.name ?? '';
  }

  // ─── related loads (§3.10) ────────────────────────────────────────────────────────────

  // Board loads in board order: the page is a range scan of the partial index
  // loads_org_board_idx that stops at OFFSET + LIMIT; the total is a separate count(*) of
  // board loads (index-only on loads_org_board_status_idx) instead of a window over them all.
  async boardLoads(organizationId: string, limit: number, offset: number): Promise<Page<{ id: string; loadNumber: number }>> {
    const board = and(eq(loads.organizationId, organizationId), isNull(loads.archivedAt));
    const [rows, [counted]] = await Promise.all([
      this.db
        .select({ id: loads.id, loadNumber: loads.loadNumber })
        .from(loads)
        .where(board)
        .orderBy(desc(loads.createdAt), desc(loads.loadNumber))
        .limit(limit)
        .offset(offset),
      this.db.select({ n: count() }).from(loads).where(board),
    ]);
    return { rows, total: counted?.n ?? 0 };
  }
}

export interface LockedColorCode {
  id: string;
  key: string;
  label: string;
  tone: PlannerTone;
  isLocked: boolean;
  position: number;
}

const storedColumns = {
  id: events.id,
  title: events.title,
  colorCodeId: events.colorCodeId,
  startDate: events.startDate,
  endDate: events.endDate,
  startTime: events.startTime,
  endTime: events.endTime,
  place: events.place,
  notes: events.notes,
  people: events.people,
  loadId: events.loadId,
};

// The load's labels: its customer and its live dispatch's driver, truck and trailer.
function withLoadLabelJoins<T extends PgSelect>(query: T) {
  return query
    .innerJoin(customers, and(eq(customers.organizationId, loads.organizationId), eq(customers.id, loads.customerId)))
    .leftJoin(
      dispatches,
      and(eq(dispatches.organizationId, loads.organizationId), eq(dispatches.loadId, loads.id), ne(dispatches.status, 'cancelled')),
    )
    .leftJoin(drivers, and(eq(drivers.organizationId, dispatches.organizationId), eq(drivers.id, dispatches.driverId)))
    .leftJoin(employees, and(eq(employees.organizationId, drivers.organizationId), eq(employees.id, drivers.employeeId)))
    .leftJoin(trucks, and(eq(trucks.organizationId, dispatches.organizationId), eq(trucks.id, dispatches.truckId)))
    .leftJoin(trailers, and(eq(trailers.organizationId, dispatches.organizationId), eq(trailers.id, dispatches.trailerId)));
}

// The §2.4 join: board loads only, the locked pickup/delivery code, the live dispatch.
function withStopJoins<T extends PgSelect>(query: T) {
  return query
    .innerJoin(loads, and(eq(loads.organizationId, loadStops.organizationId), eq(loads.id, loadStops.loadId), isNull(loads.archivedAt)))
    .innerJoin(customers, and(eq(customers.organizationId, loads.organizationId), eq(customers.id, loads.customerId)))
    .innerJoin(codes, and(eq(codes.organizationId, loadStops.organizationId), sql`${codes.key} = ${loadStops.kind}::text`))
    .leftJoin(facilities, and(eq(facilities.organizationId, loadStops.organizationId), eq(facilities.id, loadStops.facilityId)))
    .leftJoin(
      dispatches,
      and(eq(dispatches.organizationId, loads.organizationId), eq(dispatches.loadId, loads.id), ne(dispatches.status, 'cancelled')),
    )
    .leftJoin(drivers, and(eq(drivers.organizationId, dispatches.organizationId), eq(drivers.id, dispatches.driverId)))
    .leftJoin(employees, and(eq(employees.organizationId, drivers.organizationId), eq(employees.id, drivers.employeeId)))
    .leftJoin(trucks, and(eq(trucks.organizationId, dispatches.organizationId), eq(trucks.id, dispatches.truckId)))
    .leftJoin(trailers, and(eq(trailers.organizationId, dispatches.organizationId), eq(trailers.id, dispatches.trailerId)));
}
