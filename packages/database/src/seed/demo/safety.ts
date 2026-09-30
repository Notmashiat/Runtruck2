import type { DbExecutor } from '../../client.js';
import { claims, complianceReminders, driverDocuments, violations, workOrders } from '../../schema/safety.js';
import { day, must, type DemoRefs } from './refs.js';

// Safety & compliance (§7.19–§7.23): Runtruck1 MAINTENANCE, DRIVER_DOCUMENTS,
// COMPLIANCE + WATCHLIST, VIOLATIONS and CLAIMS.

type WorkOrder = typeof workOrders.$inferInsert;
type DriverDocument = typeof driverDocuments.$inferInsert;
type Precision = NonNullable<DriverDocument['expiresPrecision']>;
type Violation = typeof violations.$inferInsert;
type Claim = typeof claims.$inferInsert;

type WorkOrderSeed = Pick<WorkOrder, 'item' | 'estimateCents' | 'status'> & {
  unit: { truck: string } | { trailer: string };
  due: { on: string } | { odometer: number };
  shop: string;
  completedOn?: string;
};

// In position order (§7.19). The done order was completed on its due date (C4).
export const DEMO_WORK_ORDERS: readonly WorkOrderSeed[] = [
  { unit: { truck: 'T-118' }, item: 'Turbocharger replacement', due: { on: day('09-05') }, shop: 'Sunridge shop', estimateCents: 485_000, status: 'in_shop' },
  { unit: { trailer: 'FB-12' }, item: 'DOT annual inspection', due: { on: day('09-03') }, shop: 'Sunridge shop', estimateCents: 15_000, status: 'in_shop' },
  { unit: { truck: 'T-121' }, item: 'Brake adjustment', due: { on: day('08-28') }, shop: 'Sunridge shop', estimateCents: 42_000, status: 'overdue' },
  { unit: { truck: 'T-114' }, item: 'PM service A', due: { odometer: 529_800 }, shop: 'Sunridge shop', estimateCents: 64_000, status: 'due' },
  { unit: { trailer: 'RF-27' }, item: 'Reefer unit service', due: { on: day('09-12') }, shop: 'Thermo King', estimateCents: 71_000, status: 'scheduled' },
  { unit: { truck: 'T-107' }, item: 'DOT annual inspection', due: { on: day('09-18') }, shop: 'Valley Truck Center', estimateCents: 18_500, status: 'scheduled' },
  { unit: { truck: 'T-103' }, item: 'Tire rotation', due: { odometer: 342_000 }, shop: 'Sunridge shop', estimateCents: 16_000, status: 'scheduled' },
  { unit: { truck: 'T-109' }, item: 'DOT annual inspection', due: { on: day('08-22') }, shop: 'Valley Truck Center', estimateCents: 18_500, status: 'done', completedOn: day('08-22') },
];

type DriverDocumentSeed = Pick<DriverDocument, 'documentType' | 'status'> & {
  driver: string;
  // Month precision is stored as the month's last day (§5.11.2). Null = missing.
  expiresOn: string | null;
  precision: Precision;
};

// In position order (§7.20).
export const DEMO_DRIVER_DOCUMENTS: readonly DriverDocumentSeed[] = [
  { driver: 'Marcus Hale', documentType: 'cdl', expiresOn: '2028-04-30', precision: 'month', status: 'valid' },
  { driver: 'Marcus Hale', documentType: 'medical_card', expiresOn: '2027-03-31', precision: 'month', status: 'valid' },
  { driver: 'Marcus Hale', documentType: 'clearinghouse_query', expiresOn: '2026-09-20', precision: 'day', status: 'expiring' },
  { driver: 'Dara Whitfield', documentType: 'cdl', expiresOn: '2027-11-30', precision: 'month', status: 'valid' },
  { driver: 'Dara Whitfield', documentType: 'medical_card', expiresOn: '2027-06-30', precision: 'month', status: 'valid' },
  { driver: 'Ellis Nakamura', documentType: 'cdl', expiresOn: '2027-02-28', precision: 'month', status: 'valid' },
  { driver: 'Ellis Nakamura', documentType: 'medical_card', expiresOn: '2026-10-12', precision: 'day', status: 'expiring' },
  { driver: 'Priya Raman', documentType: 'cdl', expiresOn: '2026-07-31', precision: 'month', status: 'expired' },
  { driver: 'Priya Raman', documentType: 'medical_card', expiresOn: '2028-01-31', precision: 'month', status: 'valid' },
  { driver: 'Ana Cortez', documentType: 'cdl', expiresOn: '2029-09-30', precision: 'month', status: 'valid' },
  { driver: 'Ana Cortez', documentType: 'mvr', expiresOn: '2026-09-24', precision: 'day', status: 'expiring' },
  { driver: 'Ana Cortez', documentType: 'annual_review', expiresOn: '2026-09-24', precision: 'day', status: 'expiring' },
  { driver: 'Tobias Frey', documentType: 'cdl', expiresOn: '2028-01-31', precision: 'month', status: 'valid' },
  { driver: 'Tobias Frey', documentType: 'medical_card', expiresOn: '2026-12-31', precision: 'month', status: 'valid' },
  { driver: 'Tobias Frey', documentType: 'drug_test', expiresOn: null, precision: 'month', status: 'missing' },
];

interface ReminderSeed {
  driver: string;
  itemLabel: string;
  dueOn: string;
  duePrecision: Precision;
}

// COMPLIANCE (positions 1–3) + the WATCHLIST addition (position 4), §7.21.
export const DEMO_COMPLIANCE_REMINDERS: readonly ReminderSeed[] = [
  { driver: 'Priya Raman', itemLabel: 'CDL renewal', dueOn: '2026-07-31', duePrecision: 'month' },
  { driver: 'Ellis Nakamura', itemLabel: 'Medical card', dueOn: '2026-10-12', duePrecision: 'day' },
  { driver: 'Ana Cortez', itemLabel: 'Annual MVR review', dueOn: '2026-09-24', duePrecision: 'day' },
  { driver: 'Marcus Hale', itemLabel: 'Clearinghouse query', dueOn: '2026-09-20', duePrecision: 'day' },
];

type ViolationSeed = Pick<Violation, 'occurredOn' | 'violationType' | 'severityPoints' | 'location' | 'status'> & { driver: string; truck: string };

// Newest first (§7.22).
export const DEMO_VIOLATIONS: readonly ViolationSeed[] = [
  { occurredOn: day('08-31'), driver: 'Tobias Frey', truck: 'T-118', violationType: 'Log form & manner', severityPoints: 1, location: 'I-70 POE · Loma, CO', status: 'open' },
  { occurredOn: day('08-28'), driver: 'Ellis Nakamura', truck: 'T-121', violationType: 'Brake adjustment', severityPoints: 4, location: 'I-5 scale · Cottonwood, CA', status: 'open' },
  { occurredOn: day('08-19'), driver: 'Marcus Hale', truck: 'T-114', violationType: 'Hours-of-service', severityPoints: 7, location: 'US-95 POE · Winnemucca, NV', status: 'contested' },
  { occurredOn: day('07-30'), driver: 'Dara Whitfield', truck: 'T-107', violationType: 'Lighting', severityPoints: 6, location: 'I-80 scale · Donner Pass, CA', status: 'closed' },
  { occurredOn: day('06-12'), driver: 'Tobias Frey', truck: 'T-118', violationType: 'Speeding 6–10 over', severityPoints: 4, location: 'I-70 · Grand Junction, CO', status: 'closed' },
  { occurredOn: day('05-06'), driver: 'Ellis Nakamura', truck: 'T-121', violationType: 'Log form & manner', severityPoints: 1, location: 'I-84 POE · Ontario, OR', status: 'closed' },
  { occurredOn: day('03-18'), driver: 'Ana Cortez', truck: 'T-109', violationType: 'Lighting', severityPoints: 6, location: 'I-5 scale · Ashland, OR', status: 'closed' },
];

type Claimant = { customer: string } | { facility: string } | { thirdParty: string };

type ClaimSeed = Pick<Claim, 'claimNumber' | 'occurredOn' | 'claimType' | 'reservedCents' | 'paidCents' | 'status'> & {
  driver: string;
  truck: string;
  trailer: string;
  claimant: Claimant;
};

// Newest first (§7.23). No load (Runtruck1 names none).
export const DEMO_CLAIMS: readonly ClaimSeed[] = [
  { claimNumber: 1112, occurredOn: day('08-26'), driver: 'Ellis Nakamura', truck: 'T-121', trailer: 'FB-12', claimType: 'cargo_damage', claimant: { customer: 'Cascade Building Supply' }, reservedCents: 680_000, paidCents: 0, status: 'open' },
  { claimNumber: 1111, occurredOn: day('08-14'), driver: 'Marcus Hale', truck: 'T-114', trailer: 'RF-88', claimType: 'cargo_damage', claimant: { customer: 'Northgate Foods' }, reservedCents: 420_000, paidCents: 0, status: 'under_review' },
  { claimNumber: 1110, occurredOn: day('07-22'), driver: 'Dara Whitfield', truck: 'T-107', trailer: 'DV-51', claimType: 'property_damage', claimant: { facility: 'Wasatch Crossdock' }, reservedCents: 290_000, paidCents: 265_000, status: 'settled' },
  { claimNumber: 1109, occurredOn: day('06-30'), driver: 'Tobias Frey', truck: 'T-118', trailer: 'DV-14', claimType: 'cargo_shortage', claimant: { customer: 'Sierra Ag Partners' }, reservedCents: 145_000, paidCents: 0, status: 'denied' },
  { claimNumber: 1108, occurredOn: day('05-09'), driver: 'Ana Cortez', truck: 'T-109', trailer: 'FB-04', claimType: 'bodily_injury', claimant: { thirdParty: 'R. Delgado' }, reservedCents: 2_500_000, paidCents: 1_850_000, status: 'settled' },
  { claimNumber: 1107, occurredOn: day('03-03'), driver: 'Priya Raman', truck: 'T-103', trailer: 'RF-27', claimType: 'cargo_damage', claimant: { customer: 'Northgate Foods' }, reservedCents: 310_000, paidCents: 287_500, status: 'settled' },
];

export async function seedSafety(db: DbExecutor, refs: DemoRefs): Promise<void> {
  const { organizationId } = refs;
  const driver = (name: string) => must(refs.drivers, name, 'driver');
  const truck = (unit: string) => must(refs.trucks, unit, 'truck');

  await db.insert(workOrders).values(
    DEMO_WORK_ORDERS.map((w, i) => ({
      organizationId,
      truckId: 'truck' in w.unit ? truck(w.unit.truck) : null,
      trailerId: 'trailer' in w.unit ? must(refs.trailers, w.unit.trailer, 'trailer') : null,
      item: w.item,
      dueOn: 'on' in w.due ? w.due.on : null,
      dueOdometer: 'odometer' in w.due ? w.due.odometer : null,
      shopFacilityId: must(refs.facilities, w.shop, 'facility'),
      estimateCents: w.estimateCents,
      status: w.status,
      completedOn: w.completedOn ?? null,
      position: i + 1,
    })),
  );

  await db.insert(driverDocuments).values(
    DEMO_DRIVER_DOCUMENTS.map((d, i) => ({
      organizationId,
      driverId: driver(d.driver),
      documentType: d.documentType,
      expiresOn: d.expiresOn,
      expiresPrecision: d.precision,
      status: d.status,
      position: i + 1,
    })),
  );

  await db.insert(complianceReminders).values(
    DEMO_COMPLIANCE_REMINDERS.map((r, i) => ({
      organizationId,
      driverId: driver(r.driver),
      itemLabel: r.itemLabel,
      dueOn: r.dueOn,
      duePrecision: r.duePrecision,
      position: i + 1,
    })),
  );

  await db.insert(violations).values(
    DEMO_VIOLATIONS.map(({ driver: d, truck: t, ...v }) => ({ organizationId, ...v, driverId: driver(d), truckId: truck(t) })),
  );

  await db.insert(claims).values(
    DEMO_CLAIMS.map(({ driver: d, truck: t, trailer, claimant, ...c }) => ({
      organizationId,
      ...c,
      driverId: driver(d),
      truckId: truck(t),
      trailerId: must(refs.trailers, trailer, 'trailer'),
      loadId: null,
      claimantKind: 'customer' in claimant ? ('customer' as const) : 'facility' in claimant ? ('facility' as const) : ('third_party' as const),
      claimantCustomerId: 'customer' in claimant ? must(refs.customers, claimant.customer, 'customer') : null,
      claimantFacilityId: 'facility' in claimant ? must(refs.facilities, claimant.facility, 'facility') : null,
      claimantName: 'thirdParty' in claimant ? claimant.thirdParty : null,
    })),
  );
}
