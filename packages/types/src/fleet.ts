// Fleet wire types (drivers, trucks, trailers) — specified in docs/api/fleet.md.
// The enum unions below are the canonical wire types of the fleet enums
// (docs/03-database.md §4.3); other domains import them from here.

import type { ApiSuccess, PageMeta } from './api.js';

/** `driver_duty_status`: "On duty" / "Available" / "Home time". */
export type DriverDutyStatus = 'on_duty' | 'available' | 'home_time';

/** `truck_status`: "In service" / "Service due" / "In shop". */
export type TruckStatus = 'in_service' | 'service_due' | 'in_shop';

/** `trailer_type`: "Reefer" / "Dry van" / "Flatbed". */
export type TrailerType = 'reefer' | 'dry_van' | 'flatbed';

/** `trailer_status`: "Loaded" / "Empty" / "Inspection". */
export type TrailerStatus = 'loaded' | 'empty' | 'inspection';

/** `trailer_location_kind`: which location columns apply. */
export type TrailerLocationKind = 'yard' | 'en_route' | 'city';

// ---------------------------------------------------------------------------
// GET /api/v1/drivers (docs/api/fleet.md §2)

export interface DriverTruckRef {
  id: string;
  /** "T-114" */
  unitNumber: string;
}

/** Load statuses that make a load a driver's "Current load" (fleet.md §2.2). */
export type DriverCurrentLoadStatus = 'at_pickup' | 'in_transit' | 'delayed' | 'dispatched';

/** The driver's current load; `dispatched` renders the pickup date, the others the route. */
export interface DriverCurrentLoad {
  id: string;
  /** 40218 → "L-40218" */
  loadNumber: number;
  status: DriverCurrentLoadStatus;
  /** First pickup appointment date, YYYY-MM-DD. */
  firstPickupDate: string;
  /** Short market of the first pickup ("Stockton"); null only for a facility-less fuel stop. */
  originShort: string | null;
  /** Short market of the last delivery ("SLC"); null only for a facility-less fuel stop. */
  destinationShort: string | null;
}

export interface DriverListItem {
  id: string;
  /** employees.first_name + ' ' + last_name */
  fullName: string;
  dutyStatus: DriverDutyStatus;
  /** Drive time left (ELD fact); null renders "—". */
  hosRemainingMinutes: number | null;
  /** The truck assigned to the driver ("Unit"). */
  truck: DriverTruckRef | null;
  currentLoad: DriverCurrentLoad | null;
  /** CDL expiry (driver_documents, type cdl), YYYY-MM-DD; null when none or missing. */
  cdlExpiresOn: string | null;
  /** Σ line pay of this year's settlements, cents. */
  payYtdCents: number;
  /** Σ mileage entries in the org week (Monday–Sunday containing today). */
  weekMiles: number;
}

export interface DriverHoursAtRisk {
  driverId: string;
  fullName: string;
  /** employees.last_name ("Nakamura"). */
  lastName: string;
  hosRemainingMinutes: number;
}

/** KPI figures for Fleet › Drivers, over every driver (ignores q and dutyStatus). */
export interface DriverListSummary {
  /** Org business date (YYYY-MM-DD). */
  asOf: string;
  weekStart: string;
  weekEnd: string;
  ytdStart: string;
  rosterCount: number;
  onDutyCount: number;
  availableCount: number;
  /** rosterCount − onDutyCount − availableCount (Runtruck1's formula). */
  homeTimeCount: number;
  /** On-duty drivers with less than 120 minutes left, roster order. */
  hoursAtRisk: DriverHoursAtRisk[];
  totalWeekMiles: number;
  maxWeekMiles: number;
}

export interface DriverListMeta extends PageMeta {
  summary: DriverListSummary;
}

export type DriverListResponse = ApiSuccess<DriverListItem[], DriverListMeta>;

// ---------------------------------------------------------------------------
// GET /api/v1/trucks (docs/api/fleet.md §3)

export interface TruckDriverRef {
  id: string;
  fullName: string;
}

export interface TruckListItem {
  id: string;
  unitNumber: string;
  make: string;
  model: string;
  modelYear: number;
  plateState: string;
  plateNumber: string;
  assignedDriver: TruckDriverRef | null;
  odometerMiles: number;
  /** Odometer reading at which service is due; null renders "—". */
  nextServiceMiles: number | null;
  status: TruckStatus;
}

export interface TruckServiceDue {
  truckId: string;
  unitNumber: string;
  /** next_service_miles − odometer_miles; null when there is no next-service reading. */
  milesUntilService: number | null;
}

/** KPI figures for Fleet › Trucks, over every truck (ignores q). */
export interface TruckListSummary {
  truckCount: number;
  /** Σ odometer / count, unrounded; null when there are no trucks. */
  averageOdometerMiles: number | null;
  inServiceCount: number;
  /** Units with status in_shop, list order. */
  inShopUnitNumbers: string[];
  /** Trucks with status service_due, list order. */
  serviceDue: TruckServiceDue[];
}

export interface TruckListMeta extends PageMeta {
  summary: TruckListSummary;
}

export type TruckListResponse = ApiSuccess<TruckListItem[], TruckListMeta>;

// ---------------------------------------------------------------------------
// GET /api/v1/trailers (docs/api/fleet.md §4)

/** Where a trailer is: "Yard · Modesto", "En route · I-80" or "Bakersfield, CA". */
export type TrailerLocation =
  | { kind: 'yard'; facilityId: string; facilityName: string; city: string }
  | { kind: 'en_route'; route: string }
  | { kind: 'city'; city: string; state: string };

export interface TrailerListItem {
  id: string;
  unitNumber: string;
  trailerType: TrailerType;
  lengthFt: number;
  status: TrailerStatus;
  location: TrailerLocation;
}

/** KPI figures for Fleet › Trailers, over every trailer (ignores q). */
export interface TrailerListSummary {
  trailerCount: number;
  typeCounts: Record<TrailerType, number>;
  loadedCount: number;
  /** Loaded and en route. */
  rollingCount: number;
  /** loadedCount − rollingCount (Runtruck1's formula). */
  atShippersCount: number;
  emptyCount: number;
  /** Empty and at a yard. */
  emptyAtYardCount: number;
  /** Units with status inspection, list order. */
  inspectionUnitNumbers: string[];
}

export interface TrailerListMeta extends PageMeta {
  summary: TrailerListSummary;
}

export type TrailerListResponse = ApiSuccess<TrailerListItem[], TrailerListMeta>;
