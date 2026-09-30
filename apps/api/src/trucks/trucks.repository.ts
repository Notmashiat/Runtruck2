import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@runtruck/database';
import type { TruckListItem } from '@runtruck/types';
import { and, eq, sql } from 'drizzle-orm';
import { type Database, DB } from '../database/database.module.js';

const { drivers, employees, trucks } = schema;

@Injectable()
export class TrucksRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  // Every truck of the organization with its assigned driver's name, in one statement
  // (docs/api/fleet.md §3.6). Joins match organization_id on both sides; byte-order sort
  // on the unit number keeps the order independent of the database locale (§3.2).
  async listAll(organizationId: string): Promise<TruckListItem[]> {
    const rows = await this.db
      .select({
        id: trucks.id,
        unitNumber: trucks.unitNumber,
        make: trucks.make,
        model: trucks.model,
        modelYear: trucks.modelYear,
        plateState: trucks.plateState,
        plateNumber: trucks.plateNumber,
        driverId: drivers.id,
        driverFirstName: employees.firstName,
        driverLastName: employees.lastName,
        odometerMiles: trucks.odometerMiles,
        nextServiceMiles: trucks.nextServiceMiles,
        status: trucks.status,
      })
      .from(trucks)
      .leftJoin(drivers, and(eq(drivers.organizationId, trucks.organizationId), eq(drivers.id, trucks.assignedDriverId)))
      .leftJoin(employees, and(eq(employees.organizationId, drivers.organizationId), eq(employees.id, drivers.employeeId)))
      .where(eq(trucks.organizationId, organizationId))
      .orderBy(sql`${trucks.unitNumber} collate "C"`, trucks.id);

    return rows.map(({ driverId, driverFirstName, driverLastName, ...t }) => ({
      ...t,
      assignedDriver:
        driverId !== null && driverFirstName !== null && driverLastName !== null
          ? { id: driverId, fullName: `${driverFirstName} ${driverLastName}` }
          : null,
    }));
  }
}
