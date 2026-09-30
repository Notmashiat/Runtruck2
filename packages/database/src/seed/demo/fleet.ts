import type { DbExecutor } from '../../client.js';
import { driverMileageEntries, drivers, trailers, trucks } from '../../schema/fleet.js';
import { day, must, remember, type DemoRefs } from './refs.js';

// Fleet (§7.9–§7.11): Runtruck1 DRIVERS, TRUCKS and TRAILERS. A driver's unit comes
// from trucks.assigned_driver_id and the CDL from driver_documents; the current load and
// pay YTD are computed (§6.6).

type DutyStatus = (typeof drivers.$inferInsert)['dutyStatus'];
type Truck = typeof trucks.$inferInsert;
type Trailer = typeof trailers.$inferInsert;

interface DriverSeed {
  name: string;
  dutyStatus: DutyStatus;
  hosRemainingMinutes: number | null;
  // Runtruck1 week-to-date miles, reported on the demo day (C4).
  weekMiles: number;
}

// In roster (position) order.
export const DEMO_DRIVERS: readonly DriverSeed[] = [
  { name: 'Marcus Hale', dutyStatus: 'on_duty', hosRemainingMinutes: 380, weekMiles: 2140 },
  { name: 'Dara Whitfield', dutyStatus: 'on_duty', hosRemainingMinutes: 545, weekMiles: 1980 },
  { name: 'Ellis Nakamura', dutyStatus: 'on_duty', hosRemainingMinutes: 105, weekMiles: 1760 },
  { name: 'Priya Raman', dutyStatus: 'available', hosRemainingMinutes: 660, weekMiles: 1420 },
  { name: 'Ana Cortez', dutyStatus: 'available', hosRemainingMinutes: 660, weekMiles: 1180 },
  { name: 'Tobias Frey', dutyStatus: 'home_time', hosRemainingMinutes: null, weekMiles: 640 },
];

export const MILEAGE_RECORDED_ON = day('09-03');

type TruckSeed = Pick<Truck, 'unitNumber' | 'make' | 'model' | 'modelYear' | 'plateState' | 'plateNumber' | 'odometerMiles' | 'status'> & {
  driver: string;
  nextServiceMiles: number | null;
};

export const DEMO_TRUCKS: readonly TruckSeed[] = [
  { unitNumber: 'T-103', make: 'Freightliner', model: 'Cascadia', modelYear: 2022, plateState: 'CA', plateNumber: '8HJ2019', driver: 'Priya Raman', odometerMiles: 318_440, nextServiceMiles: 342_000, status: 'in_service' },
  { unitNumber: 'T-107', make: 'Volvo', model: 'VNL 760', modelYear: 2021, plateState: 'CA', plateNumber: '7RD8842', driver: 'Dara Whitfield', odometerMiles: 402_190, nextServiceMiles: 425_000, status: 'in_service' },
  { unitNumber: 'T-109', make: 'Kenworth', model: 'T680', modelYear: 2023, plateState: 'CA', plateNumber: '9KM1174', driver: 'Ana Cortez', odometerMiles: 141_220, nextServiceMiles: 165_000, status: 'in_service' },
  { unitNumber: 'T-114', make: 'Peterbilt', model: '579', modelYear: 2020, plateState: 'CA', plateNumber: '6PL4408', driver: 'Marcus Hale', odometerMiles: 528_900, nextServiceMiles: 529_800, status: 'service_due' },
  { unitNumber: 'T-118', make: 'Freightliner', model: 'Cascadia', modelYear: 2019, plateState: 'CA', plateNumber: '5TT9930', driver: 'Tobias Frey', odometerMiles: 611_780, nextServiceMiles: null, status: 'in_shop' },
  { unitNumber: 'T-121', make: 'International', model: 'LT', modelYear: 2022, plateState: 'CA', plateNumber: '8WQ2251', driver: 'Ellis Nakamura', odometerMiles: 275_610, nextServiceMiles: 298_000, status: 'in_service' },
];

type TrailerLocation = { kind: 'yard'; facility: string } | { kind: 'en_route'; route: string } | { kind: 'city'; city: string; state: string };

type TrailerSeed = Pick<Trailer, 'unitNumber' | 'trailerType' | 'lengthFt' | 'status'> & { location: TrailerLocation };

const YARD: TrailerLocation = { kind: 'yard', facility: 'Sunridge yard' };

// In position order (§7.11).
export const DEMO_TRAILERS: readonly TrailerSeed[] = [
  { unitNumber: 'RF-27', trailerType: 'reefer', lengthFt: 53, status: 'loaded', location: { kind: 'city', city: 'Bakersfield', state: 'CA' } },
  { unitNumber: 'RF-09', trailerType: 'reefer', lengthFt: 53, status: 'empty', location: YARD },
  { unitNumber: 'RF-88', trailerType: 'reefer', lengthFt: 53, status: 'loaded', location: { kind: 'en_route', route: 'I-80' } },
  { unitNumber: 'DV-51', trailerType: 'dry_van', lengthFt: 53, status: 'loaded', location: { kind: 'city', city: 'Stockton', state: 'CA' } },
  { unitNumber: 'DV-88', trailerType: 'dry_van', lengthFt: 53, status: 'empty', location: YARD },
  { unitNumber: 'DV-14', trailerType: 'dry_van', lengthFt: 53, status: 'empty', location: { kind: 'city', city: 'Las Vegas', state: 'NV' } },
  { unitNumber: 'FB-04', trailerType: 'flatbed', lengthFt: 48, status: 'loaded', location: { kind: 'city', city: 'Redding', state: 'CA' } },
  { unitNumber: 'FB-12', trailerType: 'flatbed', lengthFt: 48, status: 'inspection', location: YARD },
];

export async function seedFleet(db: DbExecutor, refs: DemoRefs): Promise<void> {
  const { organizationId } = refs;

  const insertedDrivers = await db
    .insert(drivers)
    .values(
      DEMO_DRIVERS.map((d, i) => ({
        organizationId,
        employeeId: must(refs.employees, d.name, 'employee'),
        dutyStatus: d.dutyStatus,
        hosRemainingMinutes: d.hosRemainingMinutes,
        hosAsOf: null,
        position: i + 1,
      })),
    )
    .returning({ id: drivers.id, employeeId: drivers.employeeId });
  const nameByEmployee = new Map([...refs.employees].map(([name, id]) => [id, name]));
  remember(
    refs.drivers,
    insertedDrivers.map((d) => ({ key: must(nameByEmployee, d.employeeId, 'employee id'), id: d.id })),
  );
  const driver = (name: string) => must(refs.drivers, name, 'driver');

  await db.insert(driverMileageEntries).values(
    DEMO_DRIVERS.map((d) => ({ organizationId, driverId: driver(d.name), recordedOn: MILEAGE_RECORDED_ON, miles: d.weekMiles })),
  );

  const insertedTrucks = await db
    .insert(trucks)
    .values(
      DEMO_TRUCKS.map(({ driver: name, ...t }) => ({
        organizationId,
        ...t,
        assignedDriverId: driver(name),
      })),
    )
    .returning({ key: trucks.unitNumber, id: trucks.id });
  remember(refs.trucks, insertedTrucks);

  const insertedTrailers = await db
    .insert(trailers)
    .values(
      DEMO_TRAILERS.map(({ location, ...t }, i) => ({
        organizationId,
        ...t,
        locationKind: location.kind,
        locationFacilityId: location.kind === 'yard' ? must(refs.facilities, location.facility, 'facility') : null,
        locationRoute: location.kind === 'en_route' ? location.route : null,
        locationCity: location.kind === 'city' ? location.city : null,
        locationState: location.kind === 'city' ? location.state : null,
        position: i + 1,
      })),
    )
    .returning({ key: trailers.unitNumber, id: trailers.id });
  remember(refs.trailers, insertedTrailers);
}
