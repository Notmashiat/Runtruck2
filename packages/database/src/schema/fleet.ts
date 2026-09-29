import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_columns.js';
import { tenantFk, tenantKey } from './_tenant.js';
import { facilities } from './facilities.js';
import { employees } from './hr.js';
import { organizationId } from './platform.js';

// Fleet: drivers (with HOS and mileage facts), trucks and trailers. Specified in docs/03-database.md §5.5.

// Runtruck1: On duty / Available / Home time.
export const driverDutyStatus = pgEnum('driver_duty_status', ['on_duty', 'available', 'home_time']);

// Runtruck1: In service / Service due / In shop.
export const truckStatus = pgEnum('truck_status', ['in_service', 'service_due', 'in_shop']);

// Runtruck1: Reefer / Dry van / Flatbed.
export const trailerType = pgEnum('trailer_type', ['reefer', 'dry_van', 'flatbed']);

// Runtruck1: Loaded / Empty / Inspection.
export const trailerStatus = pgEnum('trailer_status', ['loaded', 'empty', 'inspection']);

// "Yard · Modesto" / "En route · I-80" / "Bakersfield, CA".
export const trailerLocationKind = pgEnum('trailer_location_kind', ['yard', 'en_route', 'city']);

export const drivers = pgTable(
  'drivers',
  {
    id: id(),
    organizationId: organizationId(),
    employeeId: uuid().notNull(),
    dutyStatus: driverDutyStatus().notNull(),
    // Drive time left as last reported (ELD fact). Null renders "—".
    hosRemainingMinutes: integer(),
    hosAsOf: timestamp({ withTimezone: true, mode: 'date' }),
    // Roster order.
    position: integer().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('drivers', t),
    tenantFk('drivers_employee_fk', t.organizationId, t.employeeId, employees).onDelete('restrict'),
    uniqueIndex('drivers_org_employee_uq').on(t.organizationId, t.employeeId),
    index('drivers_org_position_idx').on(t.organizationId, t.position),
    check('drivers_hos_ck', sql`${t.hosRemainingMinutes} is null or ${t.hosRemainingMinutes} >= 0`),
  ],
);

// Miles reported for a driver (ELD mileage fact); "Miles per driver, this week" sums them.
export const driverMileageEntries = pgTable(
  'driver_mileage_entries',
  {
    id: id(),
    organizationId: organizationId(),
    driverId: uuid().notNull(),
    // Org-local business day the miles were reported for.
    recordedOn: date({ mode: 'string' }).notNull(),
    miles: integer().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('driver_mileage_entries', t),
    tenantFk('driver_mileage_entries_driver_fk', t.organizationId, t.driverId, drivers).onDelete('cascade'),
    index('driver_mileage_entries_org_recorded_idx').on(t.organizationId, t.recordedOn),
    index('driver_mileage_entries_org_driver_idx').on(t.organizationId, t.driverId, t.recordedOn),
    check('driver_mileage_entries_miles_ck', sql`${t.miles} >= 0`),
  ],
);

export const trucks = pgTable(
  'trucks',
  {
    id: id(),
    organizationId: organizationId(),
    unitNumber: text().notNull(),
    make: text().notNull(),
    model: text().notNull(),
    modelYear: smallint().notNull(),
    plateState: text().notNull(),
    plateNumber: text().notNull(),
    // The driver's "Unit" and the truck's "Driver" column. At most one truck per driver.
    assignedDriverId: uuid(),
    odometerMiles: integer().notNull(),
    // Odometer reading at which the next service is due; null renders "—".
    nextServiceMiles: integer(),
    status: truckStatus().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('trucks', t),
    tenantFk('trucks_assigned_driver_fk', t.organizationId, t.assignedDriverId, drivers).onDelete('restrict'),
    uniqueIndex('trucks_org_unit_uq').on(t.organizationId, t.unitNumber),
    uniqueIndex('trucks_org_assigned_driver_uq')
      .on(t.organizationId, t.assignedDriverId)
      .where(sql`${t.assignedDriverId} is not null`),
    check('trucks_odometer_ck', sql`${t.odometerMiles} >= 0 and (${t.nextServiceMiles} is null or ${t.nextServiceMiles} >= 0)`),
  ],
);

export const trailers = pgTable(
  'trailers',
  {
    id: id(),
    organizationId: organizationId(),
    unitNumber: text().notNull(),
    trailerType: trailerType().notNull(),
    lengthFt: smallint().notNull(),
    status: trailerStatus().notNull(),
    locationKind: trailerLocationKind().notNull(),
    // yard: the yard facility ("Yard · " + facility city).
    locationFacilityId: uuid(),
    // en_route: the corridor ("En route · I-80").
    locationRoute: text(),
    // city: "City, ST".
    locationCity: text(),
    locationState: text(),
    // Hand-authored list order.
    position: integer().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('trailers', t),
    tenantFk('trailers_location_facility_fk', t.organizationId, t.locationFacilityId, facilities).onDelete('restrict'),
    uniqueIndex('trailers_org_unit_uq').on(t.organizationId, t.unitNumber),
    index('trailers_org_position_idx').on(t.organizationId, t.position),
    check('trailers_length_ck', sql`${t.lengthFt} > 0`),
    check(
      'trailers_location_ck',
      sql`(${t.locationKind} = 'yard' and ${t.locationFacilityId} is not null)
        or (${t.locationKind} = 'en_route' and ${t.locationRoute} is not null)
        or (${t.locationKind} = 'city' and ${t.locationCity} is not null and ${t.locationState} is not null)`,
    ),
  ],
);
