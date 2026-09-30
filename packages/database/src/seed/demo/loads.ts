import type { DbExecutor } from '../../client.js';
import { dispatches, loadActivity, loads, loadStops } from '../../schema/loads.js';
import { OWN_FLEET_CARRIER } from './carriers.js';
import { customerTerms } from './customers.js';
import { demoFacility } from './facilities.js';
import { DEMO_DAY_START_UTC, ORG_TIMEZONE, day, must, remember, type DemoRefs } from './refs.js';

// Loads (§7.12–§7.14): Runtruck1's 8 board loads with their D7 rows (fuel stop,
// dispatch, "Today" activity), the 11 UNINVOICED loads and the 12 loads referenced
// only by an invoice, the last two groups archived. Documents: documents.ts.

type Load = typeof loads.$inferInsert;
type StopStatus = NonNullable<(typeof loadStops.$inferInsert)['status']>;
type DispatchStatus = NonNullable<(typeof dispatches.$inferInsert)['status']>;

interface StopSeed {
  facility: string;
  date: string;
  status: StopStatus;
}

interface BoardLoadSeed {
  loadNumber: number;
  customer: string;
  status: Load['status'];
  tenderRef: string;
  equipmentType: NonNullable<Load['equipmentType']>;
  commodity: string;
  weightLb: number;
  temperatureF: string | null;
  // Own fleet (Sunridge Freight) or not yet covered.
  covered: boolean;
  lineHaulCents: number;
  loadedMiles: number;
  emptyMiles: number | null;
  driverPayCents: number | null;
  operatingCostCents: number | null;
  pickup: StopSeed;
  delivery: StopSeed;
  dispatch: { driver: string; truck: string; trailer: string; status: DispatchStatus } | null;
}

// Runtruck1's board order (LOADS). created_at = 2026-09-03T00:00:00Z minus i minutes (§7.12).
export const BOARD_LOADS: readonly BoardLoadSeed[] = [
  {
    loadNumber: 40218, customer: 'Northgate Foods', status: 'in_transit', tenderRef: 'PO 88-41207', equipmentType: 'reefer_53', commodity: 'Frozen produce', weightLb: 41_200, temperatureF: '-10.0',
    covered: true, lineHaulCents: 245_000, loadedMiles: 478, emptyMiles: 40, driverPayCents: 61_200, operatingCostCents: 62_400,
    pickup: { facility: 'Northgate Cold Storage', date: day('09-03'), status: 'completed' },
    delivery: { facility: 'Reno Grocers DC', date: day('09-04'), status: 'pending' },
    dispatch: { driver: 'Marcus Hale', truck: 'T-114', trailer: 'RF-88', status: 'assigned' },
  },
  {
    loadNumber: 40219, customer: 'Bayline Distribution', status: 'at_pickup', tenderRef: 'PO 55-90114', equipmentType: 'dry_van_53', commodity: 'Palletized dry goods', weightLb: 38_500, temperatureF: null,
    covered: true, lineHaulCents: 318_000, loadedMiles: 736, emptyMiles: 62, driverPayCents: 79_500, operatingCostCents: 84_500,
    pickup: { facility: 'Bayline DC 4', date: day('09-03'), status: 'arrived' },
    delivery: { facility: 'Wasatch Crossdock', date: day('09-05'), status: 'pending' },
    dispatch: { driver: 'Dara Whitfield', truck: 'T-107', trailer: 'DV-51', status: 'assigned' },
  },
  {
    loadNumber: 40220, customer: 'Cascade Building Supply', status: 'delayed', tenderRef: 'SO 7741', equipmentType: 'flatbed_tarped', commodity: 'Lumber', weightLb: 44_000, temperatureF: null,
    covered: true, lineHaulCents: 291_000, loadedMiles: 602, emptyMiles: 51, driverPayCents: 72_800, operatingCostCents: 79_400,
    pickup: { facility: 'Cascade Yard 2', date: day('09-02'), status: 'completed' },
    delivery: { facility: 'Boise Builders Depot', date: day('09-04'), status: 'pending' },
    dispatch: { driver: 'Ellis Nakamura', truck: 'T-121', trailer: 'FB-12', status: 'assigned' },
  },
  {
    // C7: the pickup is stored completed to keep Runtruck1's "Pickup · complete".
    loadNumber: 40221, customer: 'Harbor Point Retail', status: 'needs_driver', tenderRef: 'PO 31-2280', equipmentType: 'dry_van_53', commodity: 'Consumer goods', weightLb: 30_100, temperatureF: null,
    covered: false, lineHaulCents: 354_000, loadedMiles: 632, emptyMiles: null, driverPayCents: null, operatingCostCents: null,
    pickup: { facility: 'Port of Oakland, Berth 22', date: day('09-04'), status: 'completed' },
    delivery: { facility: 'Harbor Point DC', date: day('09-06'), status: 'pending' },
    dispatch: null,
  },
  {
    // C7: the delivery is stored pending to keep Runtruck1's plain "Delivery".
    loadNumber: 40214, customer: 'Northgate Foods', status: 'needs_pod', tenderRef: 'PO 88-41190', equipmentType: 'reefer_53', commodity: 'Dairy', weightLb: 36_800, temperatureF: '34.0',
    covered: true, lineHaulCents: 198_000, loadedMiles: 389, emptyMiles: 33, driverPayCents: 49_500, operatingCostCents: 49_900,
    pickup: { facility: 'Northgate Creamery', date: day('09-01'), status: 'completed' },
    delivery: { facility: 'Valley Foods DC', date: day('09-02'), status: 'pending' },
    dispatch: { driver: 'Priya Raman', truck: 'T-103', trailer: 'RF-27', status: 'completed' },
  },
  {
    loadNumber: 40212, customer: 'Bayline Distribution', status: 'delivered', tenderRef: 'PO 55-89902', equipmentType: 'dry_van_53', commodity: 'Beverages', weightLb: 42_000, temperatureF: null,
    covered: true, lineHaulCents: 164_000, loadedMiles: 271, emptyMiles: 23, driverPayCents: 41_000, operatingCostCents: 38_800,
    pickup: { facility: 'Bayline LA Annex', date: day('08-31'), status: 'completed' },
    delivery: { facility: 'Sunset Beverage DC', date: day('09-01'), status: 'completed' },
    dispatch: { driver: 'Marcus Hale', truck: 'T-114', trailer: 'DV-88', status: 'completed' },
  },
  {
    loadNumber: 40210, customer: 'Sierra Ag Partners', status: 'delivered', tenderRef: 'SO 2214', equipmentType: 'dry_van_53', commodity: 'Almonds', weightLb: 43_500, temperatureF: null,
    covered: true, lineHaulCents: 412_000, loadedMiles: 1142, emptyMiles: 116, driverPayCents: 103_000, operatingCostCents: 118_600,
    pickup: { facility: 'Sierra Ag Huller 3', date: day('08-29'), status: 'completed' },
    delivery: { facility: 'Front Range Foods', date: day('09-01'), status: 'completed' },
    dispatch: { driver: 'Tobias Frey', truck: 'T-118', trailer: 'DV-14', status: 'completed' },
  },
  {
    // C7: the pickup is stored completed to keep Runtruck1's "Pickup · complete".
    loadNumber: 40222, customer: 'Cascade Building Supply', status: 'dispatched', tenderRef: 'SO 7802', equipmentType: 'flatbed_48', commodity: 'Steel coil', weightLb: 46_000, temperatureF: null,
    covered: true, lineHaulCents: 276_000, loadedMiles: 578, emptyMiles: 49, driverPayCents: 69_000, operatingCostCents: 75_800,
    pickup: { facility: 'Cascade Mill', date: day('09-05'), status: 'completed' },
    delivery: { facility: 'Duwamish Steel Yard', date: day('09-06'), status: 'pending' },
    dispatch: { driver: 'Ana Cortez', truck: 'T-109', trailer: 'FB-04', status: 'assigned' },
  },
];

const BOARD_CREATED_AT_BASE = Date.parse('2026-09-03T00:00:00Z');
const MINUTE_MS = 60_000;

interface ArchivedLoadSeed {
  loadNumber: number;
  customer: string;
  status: Load['status'];
  lineHaulCents: number;
}

interface UninvoicedLoadSeed extends ArchivedLoadSeed {
  pickup: { facility: string; date: string };
  delivery: { facility: string; date: string };
  podAttached: boolean;
}

// Runtruck1 UNINVOICED, in its order (§7.13): delivered when the POD is attached,
// needs_pod when it is missing. Pickup dates are lane transit days before delivery (C4).
export const UNINVOICED_LOADS: readonly UninvoicedLoadSeed[] = [
  { loadNumber: 40209, customer: 'Northgate Foods', status: 'delivered', lineHaulCents: 245_000, pickup: { facility: 'Northgate Cold Storage', date: day('09-01') }, delivery: { facility: 'Reno Grocers DC', date: day('09-02') }, podAttached: true },
  { loadNumber: 40208, customer: 'Bayline Distribution', status: 'delivered', lineHaulCents: 318_000, pickup: { facility: 'Bayline DC 4', date: day('08-31') }, delivery: { facility: 'Wasatch Crossdock', date: day('09-02') }, podAttached: true },
  { loadNumber: 40207, customer: 'Cascade Building Supply', status: 'needs_pod', lineHaulCents: 291_000, pickup: { facility: 'Cascade Yard 2', date: day('08-31') }, delivery: { facility: 'Boise Builders Depot', date: day('09-02') }, podAttached: false },
  { loadNumber: 40206, customer: 'Harbor Point Retail', status: 'delivered', lineHaulCents: 354_000, pickup: { facility: 'Port of Oakland, Berth 22', date: day('08-30') }, delivery: { facility: 'Harbor Point DC', date: day('09-01') }, podAttached: true },
  { loadNumber: 40204, customer: 'Vantage Home Goods', status: 'needs_pod', lineHaulCents: 288_000, pickup: { facility: 'Bayline DC 4', date: day('08-30') }, delivery: { facility: 'Sunset Beverage DC', date: day('08-31') }, podAttached: false },
  { loadNumber: 40203, customer: 'Northgate Foods', status: 'delivered', lineHaulCents: 198_000, pickup: { facility: 'Northgate Creamery', date: day('08-30') }, delivery: { facility: 'Valley Foods DC', date: day('08-31') }, podAttached: true },
  { loadNumber: 40205, customer: 'Sierra Ag Partners', status: 'delivered', lineHaulCents: 412_000, pickup: { facility: 'Sierra Ag Huller 3', date: day('08-27') }, delivery: { facility: 'Front Range Foods', date: day('08-30') }, podAttached: true },
  { loadNumber: 40202, customer: 'Bayline Distribution', status: 'delivered', lineHaulCents: 362_000, pickup: { facility: 'Northgate Cold Storage', date: day('08-28') }, delivery: { facility: 'Harbor Point DC', date: day('08-30') }, podAttached: true },
  { loadNumber: 40201, customer: 'Cascade Building Supply', status: 'delivered', lineHaulCents: 276_000, pickup: { facility: 'Cascade Mill', date: day('08-28') }, delivery: { facility: 'Duwamish Steel Yard', date: day('08-29') }, podAttached: true },
  { loadNumber: 40200, customer: 'Sierra Ag Partners', status: 'needs_pod', lineHaulCents: 305_000, pickup: { facility: 'Sierra Ag Huller 3', date: day('08-26') }, delivery: { facility: 'Wasatch Crossdock', date: day('08-28') }, podAttached: false },
  { loadNumber: 40199, customer: 'Vantage Home Goods', status: 'delivered', lineHaulCents: 441_000, pickup: { facility: 'Cascade Yard 2', date: day('08-24') }, delivery: { facility: 'Front Range Foods', date: day('08-27') }, podAttached: true },
];

// Loads that only an invoice references (§7.14): minimal archived history, no stops (C8).
export const INVOICE_ONLY_LOADS: readonly ArchivedLoadSeed[] = [
  { loadNumber: 40198, customer: 'Cascade Building Supply', status: 'delivered', lineHaulCents: 288_000 },
  { loadNumber: 40197, customer: 'Vantage Home Goods', status: 'delivered', lineHaulCents: 226_000 },
  { loadNumber: 40196, customer: 'Cascade Building Supply', status: 'delivered', lineHaulCents: 276_000 },
  { loadNumber: 40191, customer: 'Harbor Point Retail', status: 'delivered', lineHaulCents: 341_000 },
  { loadNumber: 40190, customer: 'Sierra Ag Partners', status: 'delivered', lineHaulCents: 305_000 },
  { loadNumber: 40189, customer: 'Vantage Home Goods', status: 'delivered', lineHaulCents: 189_000 },
  { loadNumber: 40187, customer: 'Northgate Foods', status: 'delivered', lineHaulCents: 245_000 },
  { loadNumber: 40183, customer: 'Bayline Distribution', status: 'delivered', lineHaulCents: 318_000 },
  { loadNumber: 40178, customer: 'Harbor Point Retail', status: 'delivered', lineHaulCents: 218_000 },
  { loadNumber: 40176, customer: 'Cascade Building Supply', status: 'delivered', lineHaulCents: 291_000 },
  { loadNumber: 40172, customer: 'Vantage Home Goods', status: 'delivered', lineHaulCents: 159_000 },
  { loadNumber: 40168, customer: 'Sierra Ag Partners', status: 'delivered', lineHaulCents: 386_000 },
];

export const ALL_DEMO_LOAD_NUMBERS: readonly number[] = [...BOARD_LOADS, ...UNINVOICED_LOADS, ...INVOICE_ONLY_LOADS].map((l) => l.loadNumber);

// Appointment windows of Runtruck1's stopsOf, facility-local (§7.12, §7.13).
const PICKUP_WINDOW = { windowOpen: '08:00', windowClose: '14:00' } as const;
const DELIVERY_WINDOW = { windowOpen: '06:00', windowClose: '12:00' } as const;

// Runtruck1 loadEvents' hash-derived planner slots (planner.ts:168-171), 2 h long.
const hhmm = (hours: number) => `${String(Math.floor(hours)).padStart(2, '0')}:${hours % 1 ? '30' : '00'}`;
export function plannedPickupSlot(loadNumber: number): { plannedStart: string; plannedEnd: string } {
  const start = 6 + (loadNumber % 7) * 1.5;
  return { plannedStart: hhmm(start), plannedEnd: hhmm(start + 2) };
}
export function plannedDeliverySlot(loadNumber: number): { plannedStart: string; plannedEnd: string } {
  const start = 7 + ((loadNumber * 3) % 8) * 1.5;
  return { plannedStart: hhmm(start), plannedEnd: hhmm(start + 2) };
}

// The D7 fuel stop Runtruck1 drew on every board load's detail page (§7.12).
export const FUEL_STOP = {
  facilityName: 'Planned · 92 gal, DEF top-off',
  addressLine1: 'Routed automatically on the lane',
  windowOpen: '16:40',
} as const;

// The D7 "Today" activity of every board load (§7.12, LoadDetailPage.tsx:50-55).
function boardActivity(load: BoardLoadSeed) {
  return [
    { sequence: 1, occurredAt: new Date('2026-09-03T14:12:00Z'), kind: 'driver_accepted' as const, message: 'Driver accepted the load in the app' },
    { sequence: 2, occurredAt: new Date('2026-09-03T15:41:00Z'), kind: 'arrived' as const, message: `Arrived at ${load.pickup.facility}` },
    { sequence: 3, occurredAt: new Date('2026-09-03T17:05:00Z'), kind: 'document_uploaded' as const, message: 'Bill of lading uploaded from the cab' },
    load.status === 'delivered'
      ? { sequence: 4, occurredAt: new Date('2026-09-03T17:06:00Z'), kind: 'invoice_queued' as const, message: 'Invoice queued for billing' }
      : { sequence: 4, occurredAt: new Date('2026-09-03T17:06:00Z'), kind: 'consignee_notified' as const, message: 'Dispatch notified the consignee' },
  ];
}

// A pickup or delivery stop at a seeded facility: the facility's name, address and zone.
function facilityStop(refs: DemoRefs, facilityName: string) {
  const facility = demoFacility(facilityName);
  return {
    facilityId: must(refs.facilities, facilityName, 'facility'),
    facilityName: facility.name,
    addressLine1: facility.addressLine1,
    city: facility.city,
    state: facility.state,
    timezone: facility.timezone,
  };
}

export async function seedLoads(db: DbExecutor, refs: DemoRefs): Promise<void> {
  const { organizationId } = refs;
  const customer = (name: string) => must(refs.customers, name, 'customer');
  const ownFleet = must(refs.carriers, OWN_FLEET_CARRIER, 'carrier');

  const boardRows = BOARD_LOADS.map((l, i) => ({
    organizationId,
    loadNumber: l.loadNumber,
    customerId: customer(l.customer),
    tenderRef: l.tenderRef,
    equipmentType: l.equipmentType,
    commodity: l.commodity,
    weightLb: l.weightLb,
    temperatureF: l.temperatureF,
    carrierId: l.covered ? ownFleet : null,
    lineHaulCents: l.lineHaulCents,
    loadedMiles: l.loadedMiles,
    emptyMiles: l.emptyMiles,
    driverPayCents: l.driverPayCents,
    operatingCostCents: l.operatingCostCents,
    paymentTerms: customerTerms(l.customer),
    status: l.status,
    createdAt: new Date(BOARD_CREATED_AT_BASE - i * MINUTE_MS),
  }));
  const archivedRows = [...UNINVOICED_LOADS, ...INVOICE_ONLY_LOADS].map((l) => ({
    organizationId,
    loadNumber: l.loadNumber,
    customerId: customer(l.customer),
    lineHaulCents: l.lineHaulCents,
    paymentTerms: customerTerms(l.customer),
    status: l.status,
    archivedAt: DEMO_DAY_START_UTC,
  }));
  const inserted = await db
    .insert(loads)
    .values([...boardRows, ...archivedRows])
    .returning({ key: loads.loadNumber, id: loads.id });
  remember(refs.loads, inserted);
  const load = (n: number) => must(refs.loads, n, 'load');

  // Board loads: 1 pickup, 2 fuel, 3 delivery (D7). Archived uninvoiced: 1 pickup, 2 delivery.
  const stops = [
    ...BOARD_LOADS.flatMap((l) => [
      {
        organizationId,
        loadId: load(l.loadNumber),
        sequence: 1,
        kind: 'pickup' as const,
        status: l.pickup.status,
        ...facilityStop(refs, l.pickup.facility),
        appointmentDate: l.pickup.date,
        ...PICKUP_WINDOW,
        ...plannedPickupSlot(l.loadNumber),
      },
      {
        organizationId,
        loadId: load(l.loadNumber),
        sequence: 2,
        kind: 'fuel' as const,
        status: 'pending' as const,
        facilityId: null,
        facilityName: FUEL_STOP.facilityName,
        addressLine1: FUEL_STOP.addressLine1,
        city: null,
        state: null,
        timezone: ORG_TIMEZONE,
        appointmentDate: l.pickup.date,
        windowOpen: FUEL_STOP.windowOpen,
        windowClose: null,
        plannedStart: null,
        plannedEnd: null,
      },
      {
        organizationId,
        loadId: load(l.loadNumber),
        sequence: 3,
        kind: 'delivery' as const,
        status: l.delivery.status,
        ...facilityStop(refs, l.delivery.facility),
        appointmentDate: l.delivery.date,
        ...DELIVERY_WINDOW,
        ...plannedDeliverySlot(l.loadNumber),
      },
    ]),
    ...UNINVOICED_LOADS.flatMap((l) => [
      {
        organizationId,
        loadId: load(l.loadNumber),
        sequence: 1,
        kind: 'pickup' as const,
        status: 'completed' as const,
        ...facilityStop(refs, l.pickup.facility),
        appointmentDate: l.pickup.date,
        ...PICKUP_WINDOW,
        plannedStart: null,
        plannedEnd: null,
      },
      {
        organizationId,
        loadId: load(l.loadNumber),
        sequence: 2,
        kind: 'delivery' as const,
        status: 'completed' as const,
        ...facilityStop(refs, l.delivery.facility),
        appointmentDate: l.delivery.date,
        ...DELIVERY_WINDOW,
        plannedStart: null,
        plannedEnd: null,
      },
    ]),
  ];
  await db.insert(loadStops).values(stops);

  // Own-fleet dispatches of the covered board loads (L-40221 has none).
  await db.insert(dispatches).values(
    BOARD_LOADS.flatMap((l) =>
      l.dispatch
        ? [
            {
              organizationId,
              loadId: load(l.loadNumber),
              driverId: must(refs.drivers, l.dispatch.driver, 'driver'),
              truckId: must(refs.trucks, l.dispatch.truck, 'truck'),
              trailerId: must(refs.trailers, l.dispatch.trailer, 'trailer'),
              status: l.dispatch.status,
            },
          ]
        : [],
    ),
  );

  // D7 activity rows; the seed is not a user action, so actor_user_id stays null (§7).
  await db.insert(loadActivity).values(
    BOARD_LOADS.flatMap((l) => boardActivity(l).map((a) => ({ organizationId, loadId: load(l.loadNumber), ...a, actorUserId: null }))),
  );
}
