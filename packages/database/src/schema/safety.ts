import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgEnum, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_columns.js';
import { tenantFk, tenantKey } from './_tenant.js';
import { customers } from './customers.js';
import { facilities } from './facilities.js';
import { drivers, trailers, trucks } from './fleet.js';
import { loads } from './loads.js';
import { organizationId } from './platform.js';

// Safety & compliance: maintenance work orders, driver qualification documents,
// compliance reminders, roadside violations and claims. Specified in docs/03-database.md §5.11.

// Runtruck1: Scheduled / Due / Overdue / In shop / Done (stored, design brief §2).
export const workOrderStatus = pgEnum('work_order_status', ['scheduled', 'due', 'overdue', 'in_shop', 'done']);

// Runtruck1: CDL / Medical card / MVR / Annual review / Drug test / Clearinghouse query.
export const driverDocumentType = pgEnum('driver_document_type', [
  'cdl',
  'medical_card',
  'mvr',
  'annual_review',
  'drug_test',
  'clearinghouse_query',
]);

// Runtruck1: Valid / Expiring / Expired / Missing (stored, design brief §2).
export const driverDocumentStatus = pgEnum('driver_document_status', ['valid', 'expiring', 'expired', 'missing']);

// Whether a date is known to the day ("Sep 20") or only to the month ("Apr 2028").
export const datePrecision = pgEnum('date_precision', ['day', 'month']);

// Runtruck1: Open / Contested / Closed.
export const violationStatus = pgEnum('violation_status', ['open', 'contested', 'closed']);

// Runtruck1: Cargo damage / Property damage / Bodily injury / Cargo shortage.
export const claimType = pgEnum('claim_type', ['cargo_damage', 'property_damage', 'bodily_injury', 'cargo_shortage']);

export const claimantKind = pgEnum('claimant_kind', ['customer', 'facility', 'third_party']);

// Runtruck1: Open / Under review / Settled / Denied.
export const claimStatus = pgEnum('claim_status', ['open', 'under_review', 'settled', 'denied']);

export const workOrders = pgTable(
  'work_orders',
  {
    id: id(),
    organizationId: organizationId(),
    // Exactly one unit: a truck or a trailer.
    truckId: uuid(),
    trailerId: uuid(),
    item: text().notNull(),
    // Exactly one due: a business day, or an odometer reading ("529,800 mi").
    dueOn: date({ mode: 'string' }),
    dueOdometer: integer(),
    shopFacilityId: uuid().notNull(),
    estimateCents: integer().notNull(),
    status: workOrderStatus().notNull(),
    completedOn: date({ mode: 'string' }),
    // Hand-authored list order.
    position: integer().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('work_orders', t),
    tenantFk('work_orders_truck_fk', t.organizationId, t.truckId, trucks).onDelete('restrict'),
    tenantFk('work_orders_trailer_fk', t.organizationId, t.trailerId, trailers).onDelete('restrict'),
    tenantFk('work_orders_shop_fk', t.organizationId, t.shopFacilityId, facilities).onDelete('restrict'),
    index('work_orders_org_position_idx').on(t.organizationId, t.position),
    index('work_orders_org_status_idx').on(t.organizationId, t.status),
    check('work_orders_unit_ck', sql`(${t.truckId} is null) <> (${t.trailerId} is null)`),
    check('work_orders_due_ck', sql`(${t.dueOn} is null) <> (${t.dueOdometer} is null)`),
    check('work_orders_estimate_ck', sql`${t.estimateCents} >= 0`),
    check('work_orders_done_ck', sql`(${t.status} = 'done') = (${t.completedOn} is not null)`),
  ],
);

// Driver qualification file (design brief §2 canonical name).
export const driverDocuments = pgTable(
  'driver_documents',
  {
    id: id(),
    organizationId: organizationId(),
    driverId: uuid().notNull(),
    documentType: driverDocumentType().notNull(),
    // Null = missing. Month-precision dates are stored as the last day of the month.
    expiresOn: date({ mode: 'string' }),
    expiresPrecision: datePrecision().notNull().default('month'),
    status: driverDocumentStatus().notNull(),
    // Roster order, then the order within the driver's file.
    position: integer().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('driver_documents', t),
    tenantFk('driver_documents_driver_fk', t.organizationId, t.driverId, drivers).onDelete('cascade'),
    uniqueIndex('driver_documents_org_driver_type_uq').on(t.organizationId, t.driverId, t.documentType),
    index('driver_documents_org_position_idx').on(t.organizationId, t.position),
    check('driver_documents_missing_ck', sql`(${t.status} = 'missing') = (${t.expiresOn} is null)`),
  ],
);

// The compliance watchlist (Drivers tab), kept as its own record list (design brief §2).
export const complianceReminders = pgTable(
  'compliance_reminders',
  {
    id: id(),
    organizationId: organizationId(),
    driverId: uuid().notNull(),
    // "CDL renewal", "Medical card", "Annual MVR review", "Clearinghouse query".
    itemLabel: text().notNull(),
    dueOn: date({ mode: 'string' }).notNull(),
    duePrecision: datePrecision().notNull(),
    position: integer().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('compliance_reminders', t),
    tenantFk('compliance_reminders_driver_fk', t.organizationId, t.driverId, drivers).onDelete('cascade'),
    index('compliance_reminders_org_position_idx').on(t.organizationId, t.position),
  ],
);

export const violations = pgTable(
  'violations',
  {
    id: id(),
    organizationId: organizationId(),
    occurredOn: date({ mode: 'string' }).notNull(),
    driverId: uuid().notNull(),
    truckId: uuid().notNull(),
    violationType: text().notNull(),
    // CSA severity weight.
    severityPoints: smallint().notNull(),
    // "I-70 POE · Loma, CO".
    location: text().notNull(),
    status: violationStatus().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('violations', t),
    tenantFk('violations_driver_fk', t.organizationId, t.driverId, drivers).onDelete('restrict'),
    tenantFk('violations_truck_fk', t.organizationId, t.truckId, trucks).onDelete('restrict'),
    index('violations_org_occurred_idx').on(t.organizationId, t.occurredOn.desc()),
    check('violations_points_ck', sql`${t.severityPoints} >= 0`),
  ],
);

export const claims = pgTable(
  'claims',
  {
    id: id(),
    organizationId: organizationId(),
    // Human number, rendered "CLM-1112". Allocated from organization_counters key 'claim'.
    claimNumber: integer().notNull(),
    occurredOn: date({ mode: 'string' }).notNull(),
    driverId: uuid().notNull(),
    truckId: uuid().notNull(),
    trailerId: uuid(),
    loadId: uuid(),
    claimType: claimType().notNull(),
    claimantKind: claimantKind().notNull(),
    claimantCustomerId: uuid(),
    claimantFacilityId: uuid(),
    // Third-party claimant name ("R. Delgado"); personal data.
    claimantName: text(),
    reservedCents: integer().notNull(),
    paidCents: integer().notNull().default(0),
    status: claimStatus().notNull(),
    ...timestamps(),
  },
  (t) => [
    tenantKey('claims', t),
    tenantFk('claims_driver_fk', t.organizationId, t.driverId, drivers).onDelete('restrict'),
    tenantFk('claims_truck_fk', t.organizationId, t.truckId, trucks).onDelete('restrict'),
    tenantFk('claims_trailer_fk', t.organizationId, t.trailerId, trailers).onDelete('restrict'),
    tenantFk('claims_load_fk', t.organizationId, t.loadId, loads).onDelete('restrict'),
    tenantFk('claims_claimant_customer_fk', t.organizationId, t.claimantCustomerId, customers).onDelete('restrict'),
    tenantFk('claims_claimant_facility_fk', t.organizationId, t.claimantFacilityId, facilities).onDelete('restrict'),
    uniqueIndex('claims_org_number_uq').on(t.organizationId, t.claimNumber),
    check('claims_number_ck', sql`${t.claimNumber} > 0`),
    check('claims_money_ck', sql`${t.reservedCents} >= 0 and ${t.paidCents} >= 0`),
    check(
      'claims_claimant_ck',
      sql`(${t.claimantKind} = 'customer' and ${t.claimantCustomerId} is not null and ${t.claimantFacilityId} is null and ${t.claimantName} is null)
        or (${t.claimantKind} = 'facility' and ${t.claimantFacilityId} is not null and ${t.claimantCustomerId} is null and ${t.claimantName} is null)
        or (${t.claimantKind} = 'third_party' and ${t.claimantName} is not null and ${t.claimantCustomerId} is null and ${t.claimantFacilityId} is null)`,
    ),
  ],
);
