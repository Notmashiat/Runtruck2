import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, timestamps } from './_columns.js';
import { tenantFk, tenantKey } from './_tenant.js';
import { carriers } from './carriers.js';
import { customers, paymentTerms } from './customers.js';
import { facilities } from './facilities.js';
import { drivers, trailers, trucks } from './fleet.js';
import { organizationId, users } from './platform.js';

// Loads, their stops, the dispatch assignment and the user-facing activity
// timeline. Specified in docs/03-database.md §5.6.

// Runtruck1's load labels, 1:1 (design brief §2); state machine in docs/08-load-lifecycle.md.
export const loadStatus = pgEnum('load_status', [
  'needs_driver',
  'dispatched',
  'at_pickup',
  'in_transit',
  'delayed',
  'needs_pod',
  'delivered',
]);

// FTL / LTL / Partial ("Full truckload" / "Less than truckload" / "Partial").
export const loadMode = pgEnum('load_mode', ['ftl', 'ltl', 'partial']);

export const equipmentType = pgEnum('equipment_type', [
  'dry_van_53',
  'reefer_53',
  'flatbed_48',
  'flatbed_tarped',
  'step_deck_48',
  'power_only',
  'box_truck_26',
]);

export const packaging = pgEnum('packaging', ['pallets', 'skids', 'crates', 'boxes', 'drums', 'totes', 'loose']);

export const ltlService = pgEnum('ltl_service', [
  'liftgate_pickup',
  'liftgate_delivery',
  'residential_delivery',
  'inside_delivery',
  'delivery_appointment',
  'limited_access',
]);

export const stopKind = pgEnum('stop_kind', ['pickup', 'delivery', 'fuel']);

export const stopStatus = pgEnum('stop_status', ['pending', 'arrived', 'completed']);

export const dispatchStatus = pgEnum('dispatch_status', ['assigned', 'completed', 'cancelled']);

export const loadActivityKind = pgEnum('load_activity_kind', [
  'created',
  'driver_instructions',
  'driver_accepted',
  'arrived',
  'document_uploaded',
  'invoice_queued',
  'consignee_notified',
]);

// NMFC freight classes offered by New Load.
export const FREIGHT_CLASSES = [
  '50', '55', '60', '65', '70', '77.5', '85', '92.5', '100',
  '110', '125', '150', '175', '200', '250', '300', '400', '500',
] as const;

const freightClassList = sql.raw(FREIGHT_CLASSES.map((c) => `'${c}'`).join(', '));

export const loads = pgTable(
  'loads',
  {
    id: id(),
    organizationId: organizationId(),
    // Human number, rendered "L-40218". Allocated from organization_counters key 'load'.
    loadNumber: integer().notNull(),
    customerId: uuid().notNull(),
    billToCustomerId: uuid(),
    tenderRef: text(),
    customerPo: text(),
    // Null for seeded loads (the detail page then has no "Mode" row).
    mode: loadMode(),
    // Nullable only on archived history (loads_complete_ck).
    equipmentType: equipmentType(),
    dispatcherName: text(),
    commodity: text(),
    weightLb: integer(),
    pieces: integer(),
    packaging: packaging(),
    declaredValueCents: integer(),
    temperatureF: numeric({ precision: 4, scale: 1 }),
    hazmat: boolean().notNull().default(false),
    unNumber: text(),
    freightClass: text(),
    nmfc: text(),
    handlingUnits: integer(),
    lengthIn: integer(),
    widthIn: integer(),
    heightIn: integer(),
    stackable: boolean().notNull().default(false),
    // In the order the user ticked them (rendered in that order in the "LTL" row).
    ltlServices: ltlService().array().notNull().default(sql`'{}'::ltl_service[]`),
    // Own fleet or partner carrier. Null = "Not yet covered".
    carrierId: uuid(),
    carrierContactName: text(),
    carrierPhone: text(),
    // Brokered loads only: what the partner carrier is paid ("Carrier cost").
    carrierRateCents: integer(),
    // Revenue: "Rate"/"Line haul", plus the charges that make "Total to customer".
    lineHaulCents: integer().notNull(),
    fuelSurchargeCents: integer().notNull().default(0),
    accessorialCents: integer().notNull().default(0),
    loadedMiles: integer(),
    // Deadhead miles driven empty to reach the first pickup (dashboard "Deadhead miles").
    emptyMiles: integer(),
    // Own-fleet loads: the driver's pay for the load ("Driver pay").
    driverPayCents: integer(),
    // Estimated other trip costs (fuel, tolls…) deducted in the margin.
    operatingCostCents: integer(),
    paymentTerms: paymentTerms().notNull(),
    status: loadStatus().notNull(),
    driverInstructions: text(),
    internalNotes: text(),
    // Set when the load is closed off the dispatch board (board, planner and
    // "Related load" exclude archived loads).
    archivedAt: timestamp({ withTimezone: true, mode: 'date' }),
    // Null for seeded rows.
    createdByUserId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    tenantKey('loads', t),
    tenantFk('loads_customer_fk', t.organizationId, t.customerId, customers).onDelete('restrict'),
    tenantFk('loads_bill_to_customer_fk', t.organizationId, t.billToCustomerId, customers).onDelete('restrict'),
    tenantFk('loads_carrier_fk', t.organizationId, t.carrierId, carriers).onDelete('restrict'),
    uniqueIndex('loads_org_number_uq').on(t.organizationId, t.loadNumber),
    index('loads_org_board_idx')
      .on(t.organizationId, t.createdAt.desc())
      .where(sql`${t.archivedAt} is null`),
    index('loads_org_status_idx').on(t.organizationId, t.status),
    index('loads_org_customer_idx').on(t.organizationId, t.customerId),
    index('loads_org_carrier_idx').on(t.organizationId, t.carrierId),
    check('loads_number_ck', sql`${t.loadNumber} > 0`),
    check(
      'loads_money_ck',
      sql`${t.lineHaulCents} >= 0 and ${t.fuelSurchargeCents} >= 0 and ${t.accessorialCents} >= 0
        and (${t.declaredValueCents} is null or ${t.declaredValueCents} >= 0)
        and (${t.operatingCostCents} is null or ${t.operatingCostCents} >= 0)`,
    ),
    check(
      'loads_pay_ck',
      sql`(${t.driverPayCents} is null or ${t.driverPayCents} > 0)
        and (${t.carrierRateCents} is null or ${t.carrierRateCents} > 0)
        and (${t.driverPayCents} is null or ${t.carrierRateCents} is null)`,
    ),
    check(
      'loads_quantities_ck',
      sql`(${t.loadedMiles} is null or ${t.loadedMiles} >= 0) and (${t.emptyMiles} is null or ${t.emptyMiles} >= 0)
        and (${t.weightLb} is null or ${t.weightLb} > 0) and (${t.pieces} is null or ${t.pieces} >= 0)
        and (${t.handlingUnits} is null or ${t.handlingUnits} > 0)
        and (${t.lengthIn} is null or ${t.lengthIn} >= 0) and (${t.widthIn} is null or ${t.widthIn} >= 0)
        and (${t.heightIn} is null or ${t.heightIn} >= 0)`,
    ),
    check('loads_hazmat_ck', sql`not ${t.hazmat} or ${t.unNumber} is not null`),
    check('loads_ltl_ck', sql`${t.mode} is distinct from 'ltl' or (${t.freightClass} is not null and ${t.handlingUnits} is not null)`),
    check('loads_freight_class_ck', sql`${t.freightClass} is null or ${t.freightClass} in (${freightClassList})`),
    check(
      'loads_complete_ck',
      sql`${t.archivedAt} is not null
        or (${t.equipmentType} is not null and ${t.commodity} is not null and ${t.weightLb} is not null)`,
    ),
  ],
);

export const loadStops = pgTable(
  'load_stops',
  {
    id: id(),
    organizationId: organizationId(),
    loadId: uuid().notNull(),
    // 1-based order in which the truck runs the stops.
    sequence: smallint().notNull(),
    kind: stopKind().notNull(),
    // Drives the detail-page kind label ("Pickup · complete", "Pickup · at shipper").
    status: stopStatus().notNull().default('pending'),
    // Set when the stop is a known facility (market labels come from it).
    facilityId: uuid(),
    // Snapshot of what the stop card shows; free text for New Load stops.
    facilityName: text().notNull(),
    addressLine1: text(),
    city: text(),
    state: text(),
    postalCode: text(),
    // IANA zone of the wall-clock times below (the facility's, else the organization's).
    timezone: text().notNull(),
    // Facility-local business day of the appointment.
    appointmentDate: date({ mode: 'string' }).notNull(),
    // Appointment window, facility-local wall clock ("08:00–14:00"); either end may be missing.
    windowOpen: time(),
    windowClose: time(),
    // Planner slot, facility-local wall clock on appointment_date (design brief §2).
    plannedStart: time(),
    plannedEnd: time(),
    // "Pickup #" / "Delivery #".
    referenceNumber: text(),
    siteContact: text(),
    arrivedAt: timestamp({ withTimezone: true, mode: 'date' }),
    completedAt: timestamp({ withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (t) => [
    tenantKey('load_stops', t),
    tenantFk('load_stops_load_fk', t.organizationId, t.loadId, loads).onDelete('cascade'),
    tenantFk('load_stops_facility_fk', t.organizationId, t.facilityId, facilities).onDelete('restrict'),
    uniqueIndex('load_stops_load_sequence_uq').on(t.organizationId, t.loadId, t.sequence),
    index('load_stops_org_date_idx').on(t.organizationId, t.appointmentDate),
    check('load_stops_sequence_ck', sql`${t.sequence} >= 1`),
    check('load_stops_place_ck', sql`${t.kind} = 'fuel' or (${t.city} is not null and ${t.state} is not null)`),
    check(
      'load_stops_planned_ck',
      sql`(${t.plannedStart} is null and ${t.plannedEnd} is null)
        or (${t.plannedStart} is not null and ${t.plannedEnd} is not null and ${t.plannedEnd} > ${t.plannedStart})`,
    ),
    check('load_stops_arrived_ck', sql`${t.arrivedAt} is null or ${t.status} in ('arrived', 'completed')`),
    check('load_stops_completed_ck', sql`${t.completedAt} is null or ${t.status} = 'completed'`),
  ],
);

// Who hauls the load (architecture §19). At most one non-cancelled dispatch per load.
export const dispatches = pgTable(
  'dispatches',
  {
    id: id(),
    organizationId: organizationId(),
    loadId: uuid().notNull(),
    // Own fleet: references. Brokered: the partner carrier's free-text driver/unit numbers.
    driverId: uuid(),
    truckId: uuid(),
    trailerId: uuid(),
    driverName: text(),
    truckNumber: text(),
    trailerNumber: text(),
    status: dispatchStatus().notNull().default('assigned'),
    assignedAt: timestamp({ withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    assignedByUserId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    tenantKey('dispatches', t),
    tenantFk('dispatches_load_fk', t.organizationId, t.loadId, loads).onDelete('cascade'),
    tenantFk('dispatches_driver_fk', t.organizationId, t.driverId, drivers).onDelete('restrict'),
    tenantFk('dispatches_truck_fk', t.organizationId, t.truckId, trucks).onDelete('restrict'),
    tenantFk('dispatches_trailer_fk', t.organizationId, t.trailerId, trailers).onDelete('restrict'),
    uniqueIndex('dispatches_org_load_active_uq')
      .on(t.organizationId, t.loadId)
      .where(sql`${t.status} <> 'cancelled'`),
    index('dispatches_org_driver_idx').on(t.organizationId, t.driverId),
    index('dispatches_org_truck_idx').on(t.organizationId, t.truckId),
    index('dispatches_org_trailer_idx').on(t.organizationId, t.trailerId),
    check(
      'dispatches_party_ck',
      sql`(${t.driverId} is null or ${t.driverName} is null) and (${t.truckId} is null or ${t.truckNumber} is null)
        and (${t.trailerId} is null or ${t.trailerNumber} is null)`,
    ),
    check(
      'dispatches_not_empty_ck',
      sql`coalesce(${t.driverId}::text, ${t.driverName}, ${t.truckId}::text, ${t.truckNumber}, ${t.trailerId}::text, ${t.trailerNumber}) is not null`,
    ),
  ],
);

// The load detail "Activity" card. Messages are rendered when written; append-only.
export const loadActivity = pgTable(
  'load_activity',
  {
    id: id(),
    organizationId: organizationId(),
    loadId: uuid().notNull(),
    // Display order within the load (ties on occurred_at keep insertion order).
    sequence: integer().notNull(),
    occurredAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
    kind: loadActivityKind().notNull(),
    message: text().notNull(),
    actorUserId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    tenantKey('load_activity', t),
    tenantFk('load_activity_load_fk', t.organizationId, t.loadId, loads).onDelete('cascade'),
    uniqueIndex('load_activity_load_sequence_uq').on(t.organizationId, t.loadId, t.sequence),
  ],
);
