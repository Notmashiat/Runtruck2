import { Inject, Injectable } from '@nestjs/common';
import { type Database, type DbExecutor, schema } from '@runtruck/database';
import { and, asc, eq } from 'drizzle-orm';
import { DB } from '../database/database.module.js';
import type { DriverDocumentFact } from './compliance.js';
import type { DispatchValues } from './dispatch-rules.js';

const { carriers, dispatches, driverDocuments, drivers, employees, trailers, trucks } = schema;

// Look-ups of the assignment references, always inside the caller's organization: an id
// of another organization finds nothing, exactly like an unknown one (09 §3.1 E2).
@Injectable()
export class DispatchRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async findDriver(organizationId: string, driverId: string): Promise<{ id: string; employeeActive: boolean } | null> {
    const [row] = await this.db
      .select({ id: drivers.id, status: employees.status })
      .from(drivers)
      .innerJoin(employees, and(eq(employees.organizationId, drivers.organizationId), eq(employees.id, drivers.employeeId)))
      .where(and(eq(drivers.organizationId, organizationId), eq(drivers.id, driverId)))
      .limit(1);
    return row ? { id: row.id, employeeActive: row.status === 'active' } : null;
  }

  async truckExists(organizationId: string, truckId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: trucks.id })
      .from(trucks)
      .where(and(eq(trucks.organizationId, organizationId), eq(trucks.id, truckId)))
      .limit(1);
    return row !== undefined;
  }

  async trailerExists(organizationId: string, trailerId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: trailers.id })
      .from(trailers)
      .where(and(eq(trailers.organizationId, organizationId), eq(trailers.id, trailerId)))
      .limit(1);
    return row !== undefined;
  }

  async findCarrier(organizationId: string, carrierId: string): Promise<{ id: string; isOwnFleet: boolean } | null> {
    const [row] = await this.db
      .select({ id: carriers.id, isOwnFleet: carriers.isOwnFleet })
      .from(carriers)
      .where(and(eq(carriers.organizationId, organizationId), eq(carriers.id, carrierId)))
      .limit(1);
    return row ?? null;
  }

  // The organization's own authority (exactly one row, carriers_own_fleet_uq); null if none.
  async ownFleetCarrierId(organizationId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: carriers.id })
      .from(carriers)
      .where(and(eq(carriers.organizationId, organizationId), eq(carriers.isOwnFleet, true)))
      .limit(1);
    return row?.id ?? null;
  }

  // The driver's qualification file in its roster order.
  async driverDocuments(organizationId: string, driverId: string): Promise<DriverDocumentFact[]> {
    return this.db
      .select({ documentType: driverDocuments.documentType, expiresOn: driverDocuments.expiresOn })
      .from(driverDocuments)
      .where(and(eq(driverDocuments.organizationId, organizationId), eq(driverDocuments.driverId, driverId)))
      .orderBy(asc(driverDocuments.position), asc(driverDocuments.id));
  }

  async insertDispatch(tx: DbExecutor, organizationId: string, loadId: string, values: DispatchValues, assignedAt: Date, assignedByUserId: string): Promise<string> {
    const [row] = await tx
      .insert(dispatches)
      .values({ ...values, organizationId, loadId, status: 'assigned', assignedAt, assignedByUserId })
      .returning({ id: dispatches.id });
    if (!row) throw new Error('dispatch insert returned nothing');
    return row.id;
  }
}
