import type { LoadListItem, LoadStopSummary } from '@runtruck/types';
import { describe, expect, it } from 'vitest';
import {
  boardStops,
  LOAD_STATUS_LABEL,
  LOAD_STATUS_TONE,
  loadLtlText,
  loadRowMatches,
  stopKindClass,
  stopKindLabel,
  stopTimeLine,
  stopWindow,
  toLoadSearchRow,
} from './loads.js';

const ctx = { timeZone: 'America/Los_Angeles', today: '2026-09-03' };

const OWN = { id: 'c-own', name: 'Sunridge Freight', mcNumber: '812044', dotNumber: '2291176', isOwnFleet: true };

function stop(p: Partial<LoadStopSummary> & Pick<LoadStopSummary, 'kind' | 'sequence'>): LoadStopSummary {
  return {
    id: `s-${p.sequence}`,
    status: 'pending',
    facilityName: 'Facility',
    addressLabel: null,
    appointmentDate: '2026-09-03',
    windowOpen: null,
    windowClose: null,
    timezone: 'America/Los_Angeles',
    ...p,
  };
}

// Seeded L-40218 exactly as GET /loads returns it (docs/api/loads.md §3.2).
const L40218: LoadListItem = {
  id: '0b8f0c5e-0000-4000-8000-000000040218',
  loadNumber: 40218,
  status: 'in_transit',
  customer: { id: 'cu-1', name: 'Northgate Foods' },
  reference: 'PO 88-41207',
  route: 'Fresno, CA → Reno, NV',
  pickupDate: '2026-09-03',
  deliveryDate: '2026-09-04',
  origin: { facilityName: 'Northgate Cold Storage', address: '4120 S Golden State Blvd, Fresno, CA' },
  destination: { facilityName: 'Reno Grocers DC', address: '1855 E Greg St, Sparks, NV' },
  driverName: 'Marcus Hale',
  unit: 'T-114 / RF-88',
  carrier: OWN,
  mode: null,
  equipmentType: 'reefer_53',
  commodity: 'Frozen produce',
  weightLb: 41200,
  temperatureF: -10,
  ltl: null,
  lineHaulCents: 245000,
  totalCents: 245000,
  loadedMiles: 478,
  ratePerMileCents: 513,
  payKind: 'driver_pay',
  payCents: 61200,
  marginCents: 121400,
  carrierRateCents: null,
  driverInstructions: null,
  createdActivityAt: null,
  stops: [
    stop({ sequence: 1, kind: 'pickup', status: 'completed', facilityName: 'Northgate Cold Storage', windowOpen: '08:00', windowClose: '14:00' }),
    stop({ sequence: 2, kind: 'fuel', facilityName: 'Planned · 92 gal, DEF top-off', windowOpen: '16:40' }),
    stop({ sequence: 3, kind: 'delivery', facilityName: 'Reno Grocers DC', appointmentDate: '2026-09-04', windowOpen: '06:00', windowClose: '12:00' }),
  ],
};

const L40221: LoadListItem = {
  ...L40218,
  id: '0b8f0c5e-0000-4000-8000-000000040221',
  loadNumber: 40221,
  status: 'needs_driver',
  customer: { id: 'cu-4', name: 'Harbor Point Retail' },
  reference: 'PO 31-2280',
  route: 'Oakland, CA → Portland, OR',
  driverName: null,
  unit: null,
  carrier: null,
  equipmentType: 'dry_van_53',
  commodity: 'Consumer goods',
  weightLb: 30100,
  temperatureF: null,
  lineHaulCents: 354000,
  totalCents: 354000,
  loadedMiles: 632,
  ratePerMileCents: 560,
  payCents: null,
  marginCents: null,
};

describe('label and tone maps', () => {
  it('map every status to Runtruck1 labels and chip colours', () => {
    expect(LOAD_STATUS_LABEL).toEqual({
      needs_driver: 'Needs driver',
      dispatched: 'Dispatched',
      at_pickup: 'At pickup',
      in_transit: 'In transit',
      delayed: 'Delayed',
      needs_pod: 'Needs POD',
      delivered: 'Delivered',
    });
    expect(LOAD_STATUS_TONE.in_transit).toBe('blue');
    expect(LOAD_STATUS_TONE.needs_driver).toBe('amber');
    expect(LOAD_STATUS_TONE.needs_pod).toBe('amber');
    expect(LOAD_STATUS_TONE.delivered).toBe('gray');
  });
});

describe('stops', () => {
  it('labels the detail stop kinds from kind and status (03 §6.0.5)', () => {
    expect(stopKindLabel('pickup', 'pending')).toBe('Pickup');
    expect(stopKindLabel('pickup', 'arrived')).toBe('Pickup · at shipper');
    expect(stopKindLabel('pickup', 'completed')).toBe('Pickup · complete');
    expect(stopKindLabel('delivery', 'completed')).toBe('Delivery · complete');
    expect(stopKindLabel('delivery', 'pending')).toBe('Delivery');
    expect(stopKindLabel('delivery', 'arrived')).toBe('Delivery');
    expect(stopKindLabel('fuel', 'pending')).toBe('Fuel stop');
    expect(stopKindClass('fuel')).toBe('');
    expect(stopKindClass('pickup')).toBe('pickup');
  });

  it('renders the window like Runtruck1', () => {
    expect(stopWindow('08:00', '14:00')).toBe('08:00–14:00');
    expect(stopWindow('06:00', null)).toBe('06:00');
    expect(stopWindow(null, '14:00')).toBe('14:00');
    expect(stopWindow(null, null)).toBe('Any time');
    expect(stopTimeLine({ appointmentDate: '2026-09-03', windowOpen: '16:40', windowClose: null })).toBe('Sep 3 · 16:40');
    expect(stopTimeLine({ appointmentDate: '2026-09-05', windowOpen: '08:00', windowClose: '12:00' })).toBe('Sep 5 · 08:00–12:00');
  });

  it('lists only pickups and deliveries on the board', () => {
    expect(boardStops(L40218.stops).map((s) => s.sequence)).toEqual([1, 3]);
  });
});

describe('toLoadSearchRow', () => {
  it('reproduces Runtruck1 L-40218', () => {
    const row = toLoadSearchRow(L40218, ctx);
    const { stops, load, ...strings } = row;
    expect(stops).toBe(L40218.stops);
    expect(load).toBe(L40218);
    expect(strings).toEqual({
      id: 'L-40218',
      customer: 'Northgate Foods',
      route: 'Fresno, CA → Reno, NV',
      pickup: 'Sep 3',
      delivery: 'Sep 4',
      driver: 'Marcus Hale',
      unit: 'T-114 / RF-88',
      rate: '$2,450',
      status: 'In transit',
      tone: 'blue',
      miles: '478',
      rpm: '$5.13',
      pay: '$612',
      margin: '$1,214',
      commodity: 'Frozen produce',
      weight: '41,200 lb',
      equip: 'Reefer, 53 ft',
      temp: '-10 °F',
      ref: 'PO 88-41207',
      from: 'Northgate Cold Storage',
      fromAddr: '4120 S Golden State Blvd, Fresno, CA',
      to: 'Reno Grocers DC',
      toAddr: '1855 E Greg St, Sparks, NV',
      carrier: 'Sunridge Freight (own fleet)',
      carrierMc: 'MC 812044',
      carrierDot: 'DOT 2291176',
    });
  });

  it('reproduces the uncovered L-40221', () => {
    const row = toLoadSearchRow(L40221, ctx);
    expect(row.driver).toBe('Unassigned');
    expect(row.unit).toBe('—');
    expect(row.pay).toBe('—');
    expect(row.margin).toBe('—');
    expect(row.temp).toBe('Ambient');
    expect(row.carrier).toBe('Not yet covered');
    expect(row.carrierMc).toBe('—');
    expect(row.carrierDot).toBe('—');
    expect(row.status).toBe('Needs driver');
    expect(row.tone).toBe('amber');
  });

  it('adds the created-load keys (worked example B: brokered LTL, negative margin)', () => {
    const b: LoadListItem = {
      ...L40221,
      loadNumber: 40223,
      status: 'dispatched',
      mode: 'ltl',
      reference: 'PO 55-90200',
      ltl: { freightClass: '70', handlingUnits: 4, packaging: 'pallets', services: ['liftgate_delivery', 'delivery_appointment'] },
      carrier: { id: 'c-2', name: 'Valley Line Transport', mcNumber: '604117', dotNumber: '1780342', isOwnFleet: false },
      lineHaulCents: 120000,
      totalCents: 130000,
      loadedMiles: null,
      ratePerMileCents: null,
      payKind: 'carrier_cost',
      payCents: 150000,
      marginCents: -20000,
      carrierRateCents: 150000,
      driverInstructions: 'Check in at gate 3',
      createdActivityAt: '2026-09-03T21:05:00.000Z',
    };
    const row = toLoadSearchRow(b, ctx);
    expect(row.mode).toBe('Less than truckload');
    expect(row.ltl).toBe('Class 70 · 4 pallets · Liftgate at delivery · Delivery appointment');
    expect(row.carrierRate).toBe('$1,500');
    expect(row.notes).toBe('Check in at gate 3');
    expect(row.createdAt).toBe('Today 14:05');
    expect(row.miles).toBe('—');
    expect(row.rpm).toBe('—');
    expect(row.pay).toBe('$1,500');
    expect(row.margin).toBe('-$200');
    expect(row.carrier).toBe('Valley Line Transport');
    expect(row.carrierMc).toBe('MC 604117');
  });

  it('omits the created-load keys on seeded loads', () => {
    const row = toLoadSearchRow(L40218, ctx);
    for (const key of ['mode', 'ltl', 'carrierRate', 'notes', 'createdAt']) expect(key in row).toBe(false);
  });

  it('formats a load without stops (archived, invoice-only) with dashes', () => {
    const row = toLoadSearchRow({ ...L40221, route: null, pickupDate: null, deliveryDate: null, origin: null, destination: null, equipmentType: null, commodity: null, weightLb: null, stops: [] }, ctx);
    expect(row.route).toBe('—');
    expect(row.pickup).toBe('—');
    expect(row.weight).toBe('—');
    expect(row.equip).toBe('—');
    expect(row.from).toBe('');
    expect(row.toAddr).toBe('');
  });
});

describe('loadRowMatches (Runtruck1 search parity, gaps §5 #29)', () => {
  const rows = [toLoadSearchRow(L40218, ctx), toLoadSearchRow(L40221, ctx)];

  it('matches display strings case-insensitively, including hidden fields', () => {
    expect(rows.filter((r) => loadRowMatches(r, 'sunridge')).map((r) => r.id)).toEqual(['L-40218']);
    expect(rows.filter((r) => loadRowMatches(r, 'PO 88')).map((r) => r.id)).toEqual(['L-40218']);
    expect(rows.filter((r) => loadRowMatches(r, 'sparks')).map((r) => r.id)).toEqual(['L-40218', 'L-40221']);
    expect(rows.filter((r) => loadRowMatches(r, '  ')).length).toBe(2);
  });

  it('never matches the tone, the uuid or the stops', () => {
    expect(rows.some((r) => loadRowMatches(r, 'blue'))).toBe(false);
    expect(rows.some((r) => loadRowMatches(r, '0b8f0c5e'))).toBe(false);
    expect(rows.some((r) => loadRowMatches(r, 'DEF top-off'))).toBe(false);
    expect(rows.some((r) => loadRowMatches(r, 'today'))).toBe(false);
  });
});

describe('loadLtlText', () => {
  it('keeps the click order and lower-cases the packaging', () => {
    expect(loadLtlText({ freightClass: '77.5', handlingUnits: 2, packaging: 'crates', services: ['limited_access', 'liftgate_pickup'] })).toBe(
      'Class 77.5 · 2 crates · Limited access · Liftgate at pickup',
    );
  });
});
