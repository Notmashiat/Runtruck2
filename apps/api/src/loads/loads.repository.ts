import { Inject, Injectable } from '@nestjs/common';
import { type Database, type DbExecutor, schema } from '@runtruck/database';
import type { LoadActivityKind, LoadDocumentType, LoadStatus } from '@runtruck/types';
import { and, asc, desc, eq, inArray, isNull, ne, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DB } from '../database/database.module.js';
import type { ActivityRow, DispatchRow, LoadDetailRow, LoadListRow } from './loads.mapper.js';

const { carriers, customers, dispatches, documents, drivers, employees, loadActivity, loads, loadStops, trailers, trucks, users } = schema;

const billTo = alias(customers, 'bill_to');

// occurred_at of the load's `created` activity row (only New Load writes one).
const createdActivityAt = sql<Date | null>`(select ${loadActivity.occurredAt} from ${loadActivity}
  where ${loadActivity.organizationId} = ${loads.organizationId} and ${loadActivity.loadId} = ${loads.id}
    and ${loadActivity.kind} = 'created' order by ${loadActivity.sequence} limit 1)`.mapWith(loadActivity.occurredAt);

const listColumns = {
  id: loads.id,
  loadNumber: loads.loadNumber,
  status: loads.status,
  customerId: loads.customerId,
  customerName: customers.name,
  tenderRef: loads.tenderRef,
  customerPo: loads.customerPo,
  mode: loads.mode,
  equipmentType: loads.equipmentType,
  commodity: loads.commodity,
  weightLb: loads.weightLb,
  temperatureF: loads.temperatureF,
  freightClass: loads.freightClass,
  handlingUnits: loads.handlingUnits,
  packaging: loads.packaging,
  ltlServices: loads.ltlServices,
  lineHaulCents: loads.lineHaulCents,
  fuelSurchargeCents: loads.fuelSurchargeCents,
  accessorialCents: loads.accessorialCents,
  loadedMiles: loads.loadedMiles,
  driverPayCents: loads.driverPayCents,
  carrierRateCents: loads.carrierRateCents,
  operatingCostCents: loads.operatingCostCents,
  driverInstructions: loads.driverInstructions,
  carrierId: carriers.id,
  carrierName: carriers.name,
  carrierMcNumber: carriers.mcNumber,
  carrierDotNumber: carriers.dotNumber,
  carrierIsOwnFleet: carriers.isOwnFleet,
  createdActivityAt,
};

const detailColumns = {
  ...listColumns,
  billToCustomerId: billTo.id,
  billToCustomerName: billTo.name,
  dispatcherName: loads.dispatcherName,
  pieces: loads.pieces,
  declaredValueCents: loads.declaredValueCents,
  hazmat: loads.hazmat,
  unNumber: loads.unNumber,
  nmfc: loads.nmfc,
  lengthIn: loads.lengthIn,
  widthIn: loads.widthIn,
  heightIn: loads.heightIn,
  stackable: loads.stackable,
  carrierContactName: loads.carrierContactName,
  carrierPhone: loads.carrierPhone,
  emptyMiles: loads.emptyMiles,
  paymentTerms: loads.paymentTerms,
  internalNotes: loads.internalNotes,
  archivedAt: loads.archivedAt,
  createdAt: loads.createdAt,
  createdByUserId: loads.createdByUserId,
  createdByName: users.fullName,
};

// Join conditions carry organization_id equality for every tenant table (03 §1.3).
const customerJoin = and(eq(customers.organizationId, loads.organizationId), eq(customers.id, loads.customerId));
const carrierJoin = and(eq(carriers.organizationId, loads.organizationId), eq(carriers.id, loads.carrierId));
const billToJoin = and(eq(billTo.organizationId, loads.organizationId), eq(billTo.id, loads.billToCustomerId));

export type NewLoadRow = typeof loads.$inferInsert;
export type NewLoadStopRow = typeof loadStops.$inferInsert;

export interface BoardPage {
  rows: LoadListRow[];
  // count(*) OVER () of the filter; null when the page is empty.
  total: number | null;
}

// Reads and writes of the loads module (docs/api/loads.md §3.3, §4.3, §6.4). Every
// method takes the session's organization and filters on it; child rows are read only
// for the loads of the page (`load_id IN (…)`), never organization-wide.
@Injectable()
export class LoadsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  get database(): Database {
    return this.db;
  }

  // Board loads (archived excluded) of the given statuses, newest first (03 §1.10).
  async boardPage(organizationId: string, statuses: readonly LoadStatus[] | null, limit: number, offset: number): Promise<BoardPage> {
    const filters: SQL[] = [eq(loads.organizationId, organizationId), isNull(loads.archivedAt)];
    if (statuses) filters.push(inArray(loads.status, [...statuses]));
    const rows = await this.db
      .select({ ...listColumns, total: sql<number>`count(*) over ()`.mapWith(Number) })
      .from(loads)
      .innerJoin(customers, customerJoin)
      .leftJoin(carriers, carrierJoin)
      .where(and(...filters))
      .orderBy(desc(loads.createdAt), desc(loads.loadNumber))
      .limit(limit)
      .offset(offset);
    return { rows: rows.map(({ total: _total, ...row }) => row), total: rows[0]?.total ?? null };
  }

  async boardCount(organizationId: string, statuses: readonly LoadStatus[] | null): Promise<number> {
    const filters: SQL[] = [eq(loads.organizationId, organizationId), isNull(loads.archivedAt)];
    if (statuses) filters.push(inArray(loads.status, [...statuses]));
    const [row] = await this.db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(loads)
      .where(and(...filters));
    return row?.n ?? 0;
  }

  // meta.summary: status counts over board loads (index loads_org_status_idx).
  async boardStatusCounts(organizationId: string): Promise<{ status: LoadStatus; count: number }[]> {
    return this.db
      .select({ status: loads.status, count: sql<number>`count(*)`.mapWith(Number) })
      .from(loads)
      .where(and(eq(loads.organizationId, organizationId), isNull(loads.archivedAt)))
      .groupBy(loads.status);
  }

  async detail(organizationId: string, by: { id: string } | { loadNumber: number }): Promise<LoadDetailRow | null> {
    const key = 'id' in by ? eq(loads.id, by.id) : eq(loads.loadNumber, by.loadNumber);
    const [row] = await this.db
      .select(detailColumns)
      .from(loads)
      .innerJoin(customers, customerJoin)
      .leftJoin(billTo, billToJoin)
      .leftJoin(carriers, carrierJoin)
      .leftJoin(users, eq(users.id, loads.createdByUserId))
      .where(and(eq(loads.organizationId, organizationId), key))
      .limit(1);
    return row ?? null;
  }

  // The live (non-cancelled) dispatch of each load with driver, truck, trailer and
  // assigner names (index dispatches_org_load_active_uq).
  async liveDispatches(organizationId: string, loadIds: readonly string[]): Promise<Map<string, DispatchRow>> {
    if (loadIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: dispatches.id,
        loadId: dispatches.loadId,
        status: dispatches.status,
        driverId: dispatches.driverId,
        truckId: dispatches.truckId,
        trailerId: dispatches.trailerId,
        driverName: dispatches.driverName,
        truckNumber: dispatches.truckNumber,
        trailerNumber: dispatches.trailerNumber,
        assignedAt: dispatches.assignedAt,
        assignedByUserId: dispatches.assignedByUserId,
        assignedByName: users.fullName,
        driverFirstName: employees.firstName,
        driverLastName: employees.lastName,
        truckUnit: trucks.unitNumber,
        trailerUnit: trailers.unitNumber,
      })
      .from(dispatches)
      .leftJoin(drivers, and(eq(drivers.organizationId, dispatches.organizationId), eq(drivers.id, dispatches.driverId)))
      .leftJoin(employees, and(eq(employees.organizationId, drivers.organizationId), eq(employees.id, drivers.employeeId)))
      .leftJoin(trucks, and(eq(trucks.organizationId, dispatches.organizationId), eq(trucks.id, dispatches.truckId)))
      .leftJoin(trailers, and(eq(trailers.organizationId, dispatches.organizationId), eq(trailers.id, dispatches.trailerId)))
      .leftJoin(users, eq(users.id, dispatches.assignedByUserId))
      .where(and(eq(dispatches.organizationId, organizationId), inArray(dispatches.loadId, [...loadIds]), ne(dispatches.status, 'cancelled')));
    return new Map(rows.map((r) => [r.loadId, r]));
  }

  async activity(organizationId: string, loadId: string): Promise<ActivityRow[]> {
    return this.db
      .select({
        id: loadActivity.id,
        sequence: loadActivity.sequence,
        occurredAt: loadActivity.occurredAt,
        kind: loadActivity.kind,
        message: loadActivity.message,
        actorUserId: loadActivity.actorUserId,
        actorName: users.fullName,
      })
      .from(loadActivity)
      .leftJoin(users, eq(users.id, loadActivity.actorUserId))
      .where(and(eq(loadActivity.organizationId, organizationId), eq(loadActivity.loadId, loadId)))
      .orderBy(asc(loadActivity.sequence));
  }

  // Which of the given ids are customers of the organization (loads.md §6.3 S2).
  async existingCustomerIds(organizationId: string, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.organizationId, organizationId), inArray(customers.id, [...ids])));
    return new Set(rows.map((r) => r.id));
  }

  async userFullName(userId: string): Promise<string | null> {
    const [row] = await this.db.select({ fullName: users.fullName }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.fullName ?? null;
  }

  // ---- writes (inside the create transaction) -------------------------------------------

  // 03 §1.9: the next load number of the organization; the row lock serialises creates.
  async allocateLoadNumber(tx: DbExecutor, organizationId: string): Promise<number> {
    const result = await tx.execute<{ allocated: string | number }>(sql`
      insert into organization_counters (organization_id, key, next_value) values (${organizationId}, 'load', 2)
      on conflict (organization_id, key) do update
        set next_value = organization_counters.next_value + 1, updated_at = now()
      returning next_value - 1 as allocated`);
    const allocated = result.rows[0]?.allocated;
    if (allocated === undefined) throw new Error('load counter returned nothing');
    return Number(allocated);
  }

  async insertLoad(tx: DbExecutor, values: NewLoadRow): Promise<string> {
    const [row] = await tx.insert(loads).values(values).returning({ id: loads.id });
    if (!row) throw new Error('load insert returned nothing');
    return row.id;
  }

  async insertStops(tx: DbExecutor, values: NewLoadStopRow[]): Promise<void> {
    if (values.length > 0) await tx.insert(loadStops).values(values);
  }

  async insertDocumentSlots(tx: DbExecutor, organizationId: string, loadId: string, types: readonly LoadDocumentType[]): Promise<void> {
    await tx.insert(documents).values(types.map((documentType, i) => ({ organizationId, loadId, documentType, status: 'pending' as const, position: i + 1 })));
  }

  async insertActivity(
    tx: DbExecutor,
    organizationId: string,
    loadId: string,
    entries: { kind: LoadActivityKind; message: string; occurredAt: Date; actorUserId: string }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await tx.insert(loadActivity).values(entries.map((e, i) => ({ ...e, organizationId, loadId, sequence: i + 1 })));
  }
}
