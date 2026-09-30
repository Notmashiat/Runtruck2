import { createLoadSchema } from '@runtruck/validation';
import { describe, expect, it } from 'vitest';
import { type Draft, emptyStop, groupIssues, initialDraft, ratesStats, reviewStats, SECTIONS, toCreateLoadBody, validate } from './newLoadDraft';

// New Load's draft → body mapping, section errors and live preview (docs/api/loads.md
// §8.3.2–§8.3.3; Runtruck1 new-load §7–§9 worked examples).

const IDS = {
  northgate: '11111111-1111-4111-8111-111111111111',
  bayline: '22222222-2222-4222-8222-222222222222',
  priya: '33333333-3333-4333-8333-333333333333',
  t103: '44444444-4444-4444-8444-444444444444',
  rf09: '55555555-5555-4555-8555-555555555555',
  valley: '66666666-6666-4666-8666-666666666666',
};

const REFS = {
  customers: [
    { id: IDS.northgate, name: 'Northgate Foods' },
    { id: IDS.bayline, name: 'Bayline Distribution' },
  ],
  drivers: [{ id: IDS.priya, fullName: 'Priya Raman' }],
  partnerName: (id: string) => (id === IDS.valley ? 'Valley Line Transport' : undefined),
  ownFleetName: 'Sunridge Freight (own fleet)',
};

// Worked example A as typed into the dialog.
function exampleA(): Draft {
  return {
    ...initialDraft('Rosa Medina'),
    customer: IDS.northgate,
    billTo: IDS.northgate,
    equipment: 'reefer_53',
    stops: [
      { ...emptyStop('Pickup'), facility: 'Northgate Cold Storage', address: '4120 S Golden State Blvd', city: 'Fresno', state: 'ca', zip: '93725', date: '2026-09-05', from: '08:00', to: '12:00' },
      { ...emptyStop('Delivery'), facility: 'Reno Grocers DC', address: '1855 E Greg St', city: 'Sparks', state: 'NV', zip: '89431', date: '2026-09-06', from: '06:00' },
    ],
    commodity: 'Frozen produce',
    weight: '41200',
    temp: '-10',
    driver: IDS.priya,
    truck: IDS.t103,
    trailer: IDS.rf09,
    lineHaul: '2450',
    fuel: '180',
    accessorials: '75',
    miles: '478',
    driverPay: '612',
    docs: { 'Rate confirmation': 'ratecon.pdf' },
    instructions: 'Check in at gate 3',
  };
}

describe('validate (Runtruck1 validate(), §8.3.3)', () => {
  it('lists exactly Runtruck1’s 11 things for a fresh draft', () => {
    const errors = validate(initialDraft('Rosa Medina'));
    expect(errors).toEqual({
      'Load info': ['Customer', 'Equipment'],
      Stops: [
        'Stop 1: facility',
        'Stop 1: street, city and state',
        'Stop 1: date',
        'Stop 2: facility',
        'Stop 2: street, city and state',
        'Stop 2: date',
      ],
      Freight: ['Commodity', 'Weight'],
      Rates: ['Line haul rate'],
    });
    expect(SECTIONS.find((s) => errors[s]?.length)).toBe('Load info');
  });

  it('accepts worked example A', () => {
    expect(validate(exampleA())).toEqual({});
  });

  it('adds LTL and carrier rules in their sections', () => {
    const d: Draft = { ...exampleA(), mode: 'LTL', brokered: true, driver: '', truck: '', trailer: '', temp: '' };
    expect(validate(d)).toEqual({ LTL: ['Freight class', 'Handling units'], Carrier: ['Carrier', 'Carrier rate'] });
  });

  it('keeps Runtruck1’s adjacent-only date check and its hazmat rule', () => {
    const a = exampleA();
    const d: Draft = { ...a, hazmat: true, stops: [a.stops[0]!, { ...a.stops[1]!, date: '2026-09-01' }] };
    expect(validate(d)).toEqual({ Stops: ['Stop 2: date is before stop 1'], Freight: ['UN number for hazmat'] });
  });

  it('groups API issues by section', () => {
    expect(
      groupIssues([
        { path: 'customerId', message: 'Customer was not found.' },
        { path: 'haul.driverId', message: 'Driver was not found.' },
        { path: 'haul.driverPayCents', message: "Driver pay can't be negative." },
        { path: 'something.else', message: 'x' },
      ]),
    ).toEqual({ 'Load info': ['Customer was not found.'], 'Driver & equipment': ['Driver was not found.'], Rates: ["Driver pay can't be negative."], Review: ['x'] });
  });
});

describe('toCreateLoadBody (§8.3.2)', () => {
  it('maps worked example A to the documented body', () => {
    const body = toCreateLoadBody(exampleA());
    expect(body).toMatchObject({
      customerId: IDS.northgate,
      billToCustomerId: IDS.northgate,
      mode: 'ftl',
      equipmentType: 'reefer_53',
      commodity: 'Frozen produce',
      weightLb: 41200,
      temperatureF: -10,
      packaging: 'pallets',
      hazmat: false,
      unNumber: null,
      ltl: null,
      haul: { hauledBy: 'own_fleet', driverId: IDS.priya, truckId: IDS.t103, trailerId: IDS.rf09, driverPayCents: 61200 },
      lineHaulCents: 245000,
      fuelSurchargeCents: 18000,
      accessorialCents: 7500,
      loadedMiles: 478,
      paymentTerms: 'net_30',
      driverInstructions: 'Check in at gate 3',
    });
    expect(body.stops[1]).toEqual({
      kind: 'delivery',
      facilityName: 'Reno Grocers DC',
      addressLine1: '1855 E Greg St',
      city: 'Sparks',
      state: 'NV',
      postalCode: '89431',
      appointmentDate: '2026-09-06',
      windowOpen: '06:00',
      windowClose: null,
      referenceNumber: '',
      siteContact: '',
    });
    const parsed = createLoadSchema.parse(body);
    expect(parsed.stops[0]!.state).toBe('CA');
    expect(parsed.tenderRef).toBeNull();
  });

  it('maps worked example B (brokered LTL) and keeps hidden fields empty', () => {
    const d: Draft = {
      ...initialDraft('Rosa Medina'),
      customer: IDS.bayline,
      ref: 'PO 55-90200',
      mode: 'LTL',
      equipment: 'dry_van_53',
      temp: '-10',
      hazmat: false,
      unNumber: 'UN1203',
      freightClass: '70',
      handlingUnits: '4',
      services: ['Liftgate at delivery', 'Delivery appointment'],
      brokered: true,
      carrier: IDS.valley,
      carrierRate: '1500',
      driverPay: '400',
      lineHaul: '1200',
      fuel: '100',
    };
    const body = toCreateLoadBody(d);
    expect(body.temperatureF).toBeNull();
    expect(body.unNumber).toBeNull();
    expect(body.ltl).toMatchObject({ freightClass: '70', handlingUnits: 4, services: ['liftgate_delivery', 'delivery_appointment'] });
    expect(body.haul).toEqual({
      hauledBy: 'partner_carrier',
      carrierId: IDS.valley,
      carrierRateCents: 150000,
      carrierContactName: '',
      carrierPhone: '',
      driverName: '',
      truckNumber: '',
      trailerNumber: '',
    });
    expect(ratesStats(d)).toEqual([
      { label: 'Total to customer', value: '$1,300' },
      { label: 'Rate / mile', value: '—' },
      { label: 'Carrier cost', value: '$1,500' },
      { label: 'Margin', value: '-$200' },
    ]);
  });

  it('rounds sub-cent amounts and fractional quantities (L4)', () => {
    const body = toCreateLoadBody({ ...exampleA(), lineHaul: '2450.555', weight: '0.4', pieces: '' });
    expect(body.lineHaulCents).toBe(245055); // Math.round(Number(s) * 100), as documented
    expect(body.weightLb).toBe(0);
    expect(body.pieces).toBeNull();
    expect(validate({ ...exampleA(), weight: '0.4' })).toEqual({ Freight: ['Weight'] });
  });
});

describe('preview', () => {
  it('reads worked example A’s Rates and Review like Runtruck1', () => {
    const d = exampleA();
    expect(ratesStats(d)).toEqual([
      { label: 'Total to customer', value: '$2,705' },
      { label: 'Rate / mile', value: '$5.13' },
      { label: 'Driver pay', value: '$612' },
      { label: 'Margin', value: '$2,093' },
    ]);
    expect(reviewStats(d, REFS)).toEqual([
      { label: 'Customer', value: 'Northgate Foods' },
      { label: 'Mode · equipment', value: 'FTL · Reefer, 53 ft' },
      { label: 'Stops', value: '1 pickup · 1 delivery' },
      { label: 'Route', value: 'Fresno → Sparks' },
      { label: 'Freight', value: 'Frozen produce · 41,200 lb' },
      { label: 'Carrier', value: 'Sunridge Freight (own fleet)' },
      { label: 'Driver', value: 'Priya Raman' },
      { label: 'Total to customer', value: '$2,705' },
    ]);
  });

  it('reads a fresh draft with dashes', () => {
    expect(reviewStats(initialDraft('Rosa Medina'), REFS).map((s) => s.value)).toEqual([
      '—',
      'FTL · —',
      '1 pickup · 1 delivery',
      '—',
      '—',
      'Sunridge Freight (own fleet)',
      'Unassigned',
      '$0',
    ]);
    expect(reviewStats({ ...initialDraft('x'), brokered: true, driver: 'Sam Lee' }, REFS).slice(5, 7).map((s) => s.value)).toEqual(['—', 'Sam Lee']);
  });
});
