import { describe, expect, it } from 'vitest';
import { endpointsOf, stopAddressLabel, type LoadStopRow } from '../load-endpoints.js';
import { boardSummary, dispatchDriverName, dispatchUnit, payAndMargin, ratePerMileCents, toListItem, type DispatchRow, type LoadListRow } from '../loads.mapper.js';

function stop(p: Partial<LoadStopRow> & Pick<LoadStopRow, 'sequence' | 'kind'>): LoadStopRow {
  return {
    id: `s${p.sequence}`,
    loadId: 'l1',
    status: 'pending',
    facilityId: null,
    facilityName: 'Facility',
    addressLine1: null,
    city: null,
    state: null,
    postalCode: null,
    timezone: 'America/Los_Angeles',
    appointmentDate: '2026-09-03',
    windowOpen: null,
    windowClose: null,
    plannedStart: null,
    plannedEnd: null,
    referenceNumber: null,
    siteContact: null,
    arrivedAt: null,
    completedAt: null,
    facility: null,
    ...p,
  };
}

// Seeded L-40218: facility stops whose market (Reno) differs from the address city (Sparks).
const L40218_STOPS = [
  stop({
    sequence: 1,
    kind: 'pickup',
    status: 'completed',
    facilityId: 'f1',
    facilityName: 'Northgate Cold Storage',
    addressLine1: '4120 S Golden State Blvd',
    city: 'Fresno',
    state: 'CA',
    facility: { city: 'Fresno', state: 'CA', marketCity: null, marketState: null, marketShort: null },
    windowOpen: '08:00',
    windowClose: '14:00',
  }),
  stop({ sequence: 2, kind: 'fuel', facilityName: 'Planned · 92 gal, DEF top-off', addressLine1: 'Routed automatically on the lane', windowOpen: '16:40' }),
  stop({
    sequence: 3,
    kind: 'delivery',
    facilityId: 'f2',
    facilityName: 'Reno Grocers DC',
    addressLine1: '1855 E Greg St',
    city: 'Sparks',
    state: 'NV',
    appointmentDate: '2026-09-04',
    facility: { city: 'Sparks', state: 'NV', marketCity: 'Reno', marketState: 'NV', marketShort: null },
  }),
];

const ROW: LoadListRow = {
  id: 'l1',
  loadNumber: 40218,
  status: 'in_transit',
  customerId: 'c1',
  customerName: 'Northgate Foods',
  tenderRef: 'PO 88-41207',
  customerPo: null,
  mode: null,
  equipmentType: 'reefer_53',
  commodity: 'Frozen produce',
  weightLb: 41200,
  temperatureF: '-10.0',
  freightClass: null,
  handlingUnits: null,
  packaging: null,
  ltlServices: [],
  lineHaulCents: 245000,
  fuelSurchargeCents: 0,
  accessorialCents: 0,
  loadedMiles: 478,
  driverPayCents: 61200,
  carrierRateCents: null,
  operatingCostCents: 62400,
  driverInstructions: null,
  carrierId: 'k1',
  carrierName: 'Sunridge Freight',
  carrierMcNumber: '812044',
  carrierDotNumber: '2291176',
  carrierIsOwnFleet: true,
  createdActivityAt: null,
};

const DISPATCH: DispatchRow = {
  id: 'd1',
  loadId: 'l1',
  status: 'assigned',
  driverId: 'dr1',
  truckId: 't1',
  trailerId: 'r1',
  driverName: null,
  truckNumber: null,
  trailerNumber: null,
  assignedAt: new Date('2026-09-03T14:00:00Z'),
  assignedByUserId: null,
  assignedByName: null,
  driverFirstName: 'Marcus',
  driverLastName: 'Hale',
  truckUnit: 'T-114',
  trailerUnit: 'RF-88',
};

describe('toListItem (docs/api/loads.md §1, §3.2)', () => {
  it('reproduces seeded L-40218', () => {
    const item = toListItem(ROW, L40218_STOPS, DISPATCH);
    expect(item).toMatchObject({
      loadNumber: 40218,
      reference: 'PO 88-41207',
      route: 'Fresno, CA → Reno, NV',
      pickupDate: '2026-09-03',
      deliveryDate: '2026-09-04',
      origin: { facilityName: 'Northgate Cold Storage', address: '4120 S Golden State Blvd, Fresno, CA' },
      destination: { facilityName: 'Reno Grocers DC', address: '1855 E Greg St, Sparks, NV' },
      driverName: 'Marcus Hale',
      unit: 'T-114 / RF-88',
      carrier: { name: 'Sunridge Freight', mcNumber: '812044', dotNumber: '2291176', isOwnFleet: true },
      temperatureF: -10,
      ltl: null,
      totalCents: 245000,
      ratePerMileCents: 513,
      payKind: 'driver_pay',
      payCents: 61200,
      marginCents: 121400,
      createdActivityAt: null,
    });
    expect(item.stops.map((s) => [s.kind, s.addressLabel])).toEqual([
      ['pickup', '4120 S Golden State Blvd, Fresno, CA'],
      ['fuel', 'Routed automatically on the lane'],
      ['delivery', '1855 E Greg St, Sparks, NV'],
    ]);
  });

  it('reproduces the uncovered L-40221 (no carrier, no dispatch)', () => {
    const item = toListItem({ ...ROW, carrierId: null, carrierName: null, carrierMcNumber: null, carrierDotNumber: null, carrierIsOwnFleet: null, driverPayCents: null, operatingCostCents: null }, L40218_STOPS, null);
    expect(item.carrier).toBeNull();
    expect(item.driverName).toBeNull();
    expect(item.unit).toBeNull();
    expect(item.payCents).toBeNull();
    expect(item.marginCents).toBeNull();
  });

  it('computes worked example B (partner, LTL, negative margin)', () => {
    const item = toListItem(
      {
        ...ROW,
        mode: 'ltl',
        freightClass: '70',
        handlingUnits: 4,
        packaging: 'pallets',
        ltlServices: ['liftgate_delivery', 'delivery_appointment'],
        lineHaulCents: 120000,
        fuelSurchargeCents: 10000,
        loadedMiles: null,
        driverPayCents: null,
        carrierRateCents: 150000,
        operatingCostCents: null,
      },
      [],
      null,
    );
    expect(item).toMatchObject({
      route: null,
      ratePerMileCents: null,
      payKind: 'carrier_cost',
      payCents: 150000,
      marginCents: -20000,
      totalCents: 130000,
      ltl: { freightClass: '70', handlingUnits: 4, packaging: 'pallets', services: ['liftgate_delivery', 'delivery_appointment'] },
    });
  });
});

describe('derived values', () => {
  it('rounds the rate per mile half up and needs miles', () => {
    expect(ratePerMileCents(245000, 478)).toBe(513);
    expect(ratePerMileCents(412000, 1142)).toBe(361);
    expect(ratePerMileCents(100, 0)).toBeNull();
    expect(ratePerMileCents(100, null)).toBeNull();
  });

  it('margin = total − pay − operating cost; null without pay', () => {
    expect(payAndMargin({ lineHaulCents: 245000, fuelSurchargeCents: 18000, accessorialCents: 7500, carrierRateCents: null, driverPayCents: 61200, operatingCostCents: null })).toEqual({
      payKind: 'driver_pay',
      payCents: 61200,
      marginCents: 209300,
    });
    expect(payAndMargin({ lineHaulCents: 1, fuelSurchargeCents: 0, accessorialCents: 0, carrierRateCents: null, driverPayCents: null, operatingCostCents: 5 }).marginCents).toBeNull();
  });

  it('labels partner free text and partial units', () => {
    const partner: DispatchRow = { ...DISPATCH, driverId: null, truckId: null, trailerId: null, driverFirstName: null, driverLastName: null, truckUnit: null, trailerUnit: null, driverName: 'Sam Lee', truckNumber: '88', trailerNumber: null };
    expect(dispatchDriverName(partner)).toBe('Sam Lee');
    expect(dispatchUnit(partner)).toBe('88');
    expect(dispatchUnit({ ...partner, truckNumber: null })).toBeNull();
    expect(dispatchUnit({ ...DISPATCH, trailerUnit: null })).toBe('T-114');
  });

  it('endpoints fall back to the first / last stop and keep postal codes out of the route address', () => {
    const typed = [
      stop({ sequence: 1, kind: 'delivery', facilityName: 'A', addressLine1: '1 Main', city: 'Fresno', state: 'CA', postalCode: '93725' }),
      stop({ sequence: 2, kind: 'delivery', facilityName: 'B', addressLine1: '2 Main', city: 'Sparks', state: 'NV' }),
    ];
    const ends = endpointsOf(typed);
    expect(ends.route).toBe('Fresno, CA → Sparks, NV');
    expect(ends.firstPickup?.address).toBe('1 Main, Fresno, CA');
    expect(stopAddressLabel(typed[0]!)).toBe('1 Main, Fresno, CA 93725');
    expect(endpointsOf([]).route).toBeNull();
  });
});

describe('boardSummary (§3.1)', () => {
  it('counts KPIs and pills from status counts; delayed is not in transit', () => {
    expect(
      boardSummary([
        { status: 'in_transit', count: 1 },
        { status: 'at_pickup', count: 1 },
        { status: 'delayed', count: 1 },
        { status: 'needs_driver', count: 1 },
        { status: 'needs_pod', count: 1 },
        { status: 'delivered', count: 2 },
        { status: 'dispatched', count: 1 },
      ]),
    ).toEqual({ undispatched: 1, inTransit: 1, delivered: 2, needsPod: 1, views: { active: 5, 'needs-pod': 1, delivered: 2, all: 8 } });
    expect(boardSummary([])).toEqual({ undispatched: 0, inTransit: 0, delivered: 0, needsPod: 0, views: { active: 0, 'needs-pod': 0, delivered: 0, all: 0 } });
  });
});
