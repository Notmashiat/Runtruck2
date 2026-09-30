import type {
  ComplianceReminderRow,
  DriverListItem,
  DriverListSummary,
  TrailerListItem,
  TrailerListSummary,
  TruckListItem,
  TruckListSummary,
} from '@runtruck/types';
import { describe, expect, it } from 'vitest';
import {
  driverKpis,
  formatDriverCurrentLoad,
  formatTrailerLocation,
  toDriverRow,
  toDriverWatchlistRow,
  toTrailerRow,
  toTruckRow,
  trailerKpis,
  truckKpis,
} from './fleet.js';

// Seeded rows as GET /drivers returns them (docs/api/fleet.md §2.6).
const driver = (over: Partial<DriverListItem>): DriverListItem => ({
  id: 'd',
  fullName: 'Marcus Hale',
  dutyStatus: 'on_duty',
  hosRemainingMinutes: 380,
  truck: { id: 't', unitNumber: 'T-114' },
  currentLoad: {
    id: 'l',
    loadNumber: 40218,
    status: 'in_transit',
    firstPickupDate: '2026-09-02',
    originShort: 'Fresno',
    destinationShort: 'Reno',
  },
  cdlExpiresOn: '2028-04-30',
  payYtdCents: 132600,
  weekMiles: 2140,
  ...over,
});

const SEED_DRIVERS: DriverListItem[] = [
  driver({}),
  driver({
    id: 'd2',
    fullName: 'Dara Whitfield',
    hosRemainingMinutes: 545,
    truck: { id: 't2', unitNumber: 'T-107' },
    currentLoad: {
      id: 'l2',
      loadNumber: 40219,
      status: 'at_pickup',
      firstPickupDate: '2026-09-03',
      originShort: 'Stockton',
      destinationShort: 'SLC',
    },
    cdlExpiresOn: '2027-11-30',
    payYtdCents: 118800,
    weekMiles: 1980,
  }),
  driver({
    id: 'd3',
    fullName: 'Ellis Nakamura',
    hosRemainingMinutes: 105,
    truck: { id: 't3', unitNumber: 'T-121' },
    currentLoad: {
      id: 'l3',
      loadNumber: 40220,
      status: 'delayed',
      firstPickupDate: '2026-09-02',
      originShort: 'Sacramento',
      destinationShort: 'Boise',
    },
    cdlExpiresOn: '2027-02-28',
    payYtdCents: 145500,
    weekMiles: 1760,
  }),
  driver({
    id: 'd4',
    fullName: 'Priya Raman',
    dutyStatus: 'available',
    hosRemainingMinutes: 660,
    truck: { id: 't4', unitNumber: 'T-103' },
    currentLoad: null,
    cdlExpiresOn: '2026-07-31',
    payYtdCents: 82400,
    weekMiles: 1420,
  }),
  driver({
    id: 'd5',
    fullName: 'Ana Cortez',
    dutyStatus: 'available',
    hosRemainingMinutes: 660,
    truck: { id: 't5', unitNumber: 'T-109' },
    currentLoad: {
      id: 'l5',
      loadNumber: 40222,
      status: 'dispatched',
      firstPickupDate: '2026-09-05',
      originShort: 'Redding',
      destinationShort: 'Seattle',
    },
    cdlExpiresOn: '2029-09-30',
    payYtdCents: 68400,
    weekMiles: 1180,
  }),
  driver({
    id: 'd6',
    fullName: 'Tobias Frey',
    dutyStatus: 'home_time',
    hosRemainingMinutes: null,
    truck: { id: 't6', unitNumber: 'T-118' },
    currentLoad: null,
    cdlExpiresOn: '2028-01-31',
    payYtdCents: 0,
    weekMiles: 640,
  }),
];

const DRIVER_SUMMARY: DriverListSummary = {
  asOf: '2026-09-03',
  weekStart: '2026-08-31',
  weekEnd: '2026-09-06',
  ytdStart: '2026-01-01',
  rosterCount: 6,
  onDutyCount: 3,
  availableCount: 2,
  homeTimeCount: 1,
  hoursAtRisk: [{ driverId: 'd3', fullName: 'Ellis Nakamura', lastName: 'Nakamura', hosRemainingMinutes: 105 }],
  totalWeekMiles: 9120,
  maxWeekMiles: 2140,
};

describe('fleet › drivers view-model', () => {
  it('builds Runtruck1 Driver rows for the seed (pay differs by D5)', () => {
    const rows = SEED_DRIVERS.map(toDriverRow).map(({ ref: _ref, ...row }) => row);
    expect(rows).toEqual([
      {
        name: 'Marcus Hale',
        status: 'On duty',
        unit: 'T-114',
        load: 'L-40218 · Fresno → Reno',
        hos: '6h 20m',
        cdl: '04/2028',
        pay: '$1,326',
        miles: 2140,
      },
      {
        name: 'Dara Whitfield',
        status: 'On duty',
        unit: 'T-107',
        load: 'L-40219 · Stockton → SLC',
        hos: '9h 05m',
        cdl: '11/2027',
        pay: '$1,188',
        miles: 1980,
      },
      {
        name: 'Ellis Nakamura',
        status: 'On duty',
        unit: 'T-121',
        load: 'L-40220 · Sacramento → Boise',
        hos: '1h 45m',
        cdl: '02/2027',
        pay: '$1,455',
        miles: 1760,
      },
      { name: 'Priya Raman', status: 'Available', unit: 'T-103', load: '—', hos: '11h 00m', cdl: '07/2026', pay: '$824', miles: 1420 },
      {
        name: 'Ana Cortez',
        status: 'Available',
        unit: 'T-109',
        load: 'L-40222 · Sep 5',
        hos: '11h 00m',
        cdl: '09/2029',
        pay: '$684',
        miles: 1180,
      },
      { name: 'Tobias Frey', status: 'Home time', unit: 'T-118', load: '—', hos: '—', cdl: '01/2028', pay: '$0', miles: 640 },
    ]);
  });

  it('keeps ids, enums and tones in ref', () => {
    expect(toDriverRow(SEED_DRIVERS[3] as DriverListItem).ref).toEqual({ id: 'd4', dutyStatus: 'available', tone: 'gray' });
    expect(toDriverRow(SEED_DRIVERS[0] as DriverListItem).ref.tone).toBe('blue');
  });

  it('prints missing unit, CDL and route parts as "—"', () => {
    const row = toDriverRow(driver({ truck: null, cdlExpiresOn: null }));
    expect(row.unit).toBe('—');
    expect(row.cdl).toBe('—');
    expect(
      formatDriverCurrentLoad({
        id: 'x',
        loadNumber: 1,
        status: 'in_transit',
        firstPickupDate: '2026-09-01',
        originShort: null,
        destinationShort: 'Reno',
      }),
    ).toBe('L-1 · — → Reno');
  });

  it('builds the KPI row, and "—" without notes while pending or refused', () => {
    expect(driverKpis(DRIVER_SUMMARY, 4)).toEqual([
      { label: 'On the roster', value: '6', note: '3 on duty · 1 home time' },
      { label: 'Available now', value: '2', note: 'Both reset today' },
      { label: 'Hours at risk', value: '1', note: 'Nakamura · 1h 45m' },
      { label: 'Docs to renew', value: '4', note: 'On the watchlist below' },
    ]);
    expect(driverKpis(DRIVER_SUMMARY, undefined)[3]).toEqual({ label: 'Docs to renew', value: '—' });
    expect(driverKpis(undefined, undefined)).toEqual([
      { label: 'On the roster', value: '—' },
      { label: 'Available now', value: '—' },
      { label: 'Hours at risk', value: '—' },
      { label: 'Docs to renew', value: '—' },
    ]);
    expect(driverKpis({ ...DRIVER_SUMMARY, hoursAtRisk: [] }, 4)[2]?.note).toBe('Nobody under 2h');
  });

  it('formats the watchlist due date by precision', () => {
    const reminder = (dueOn: string, duePrecision: 'day' | 'month'): ComplianceReminderRow => ({
      id: 'r',
      driver: { id: 'd', fullName: 'Priya Raman' },
      itemLabel: 'CDL renewal',
      dueOn,
      duePrecision,
    });
    expect(toDriverWatchlistRow(reminder('2026-07-31', 'month'))).toEqual({
      name: 'Priya Raman',
      item: 'CDL renewal',
      due: 'Jul 2026',
      ref: { id: 'r' },
    });
    expect(toDriverWatchlistRow(reminder('2026-10-12', 'day')).due).toBe('Oct 12');
  });
});

const truck = (over: Partial<TruckListItem>): TruckListItem => ({
  id: 't',
  unitNumber: 'T-114',
  make: 'Peterbilt',
  model: '579',
  modelYear: 2020,
  plateState: 'CA',
  plateNumber: '6PL4408',
  assignedDriver: { id: 'd', fullName: 'Marcus Hale' },
  odometerMiles: 528900,
  nextServiceMiles: 529800,
  status: 'service_due',
  ...over,
});

const TRUCK_SUMMARY: TruckListSummary = {
  truckCount: 6,
  averageOdometerMiles: 379690,
  inServiceCount: 4,
  inShopUnitNumbers: ['T-118'],
  serviceDue: [{ truckId: 't', unitNumber: 'T-114', milesUntilService: 900 }],
};

describe('fleet › trucks view-model', () => {
  it('builds Runtruck1 Truck rows', () => {
    expect(toTruckRow(truck({}))).toEqual({
      unit: 'T-114',
      make: 'Peterbilt 579 · 2020',
      plate: 'CA 6PL4408',
      driver: 'Marcus Hale',
      odo: '528,900',
      service: '529,800',
      status: 'Service due',
      ref: { id: 't', tone: 'amber' },
    });
    const t118 = toTruckRow(
      truck({
        unitNumber: 'T-118',
        make: 'Freightliner',
        model: 'Cascadia',
        modelYear: 2019,
        odometerMiles: 611780,
        nextServiceMiles: null,
        status: 'in_shop',
      }),
    );
    expect(t118).toMatchObject({ make: 'Freightliner Cascadia · 2019', odo: '611,780', service: '—', status: 'In shop' });
    expect(toTruckRow(truck({ status: 'in_service', assignedDriver: null }))).toMatchObject({
      driver: '—',
      status: 'In service',
      ref: { tone: 'blue' },
    });
  });

  it('builds the KPI row with Runtruck1 literals and NaN edge cases', () => {
    expect(truckKpis(TRUCK_SUMMARY)).toEqual([
      { label: 'Power units', value: '6', note: 'Avg 380K mi' },
      { label: 'In service', value: '4', note: 'Of 6 units' },
      { label: 'In shop', value: '1', note: 'T-118 · turbo' },
      { label: 'Service due', value: '1', note: 'T-114 in 900 mi' },
    ]);
    const empty = truckKpis({ truckCount: 0, averageOdometerMiles: null, inServiceCount: 0, inShopUnitNumbers: [], serviceDue: [] });
    expect(empty.map((k) => k.note)).toEqual(['Avg NaNK mi', 'Of 0 units', 'Bays clear', 'Nothing due']);
    expect(truckKpis({ ...TRUCK_SUMMARY, serviceDue: [{ truckId: 't', unitNumber: 'T-114', milesUntilService: null }] })[3]?.note).toBe(
      'T-114 in NaN mi',
    );
    expect(truckKpis(undefined).map((k) => [k.value, k.note])).toEqual([
      ['—', undefined],
      ['—', undefined],
      ['—', undefined],
      ['—', undefined],
    ]);
  });
});

const trailer = (over: Partial<TrailerListItem>): TrailerListItem => ({
  id: 'r',
  unitNumber: 'RF-88',
  trailerType: 'reefer',
  lengthFt: 53,
  status: 'loaded',
  location: { kind: 'en_route', route: 'I-80' },
  ...over,
});

describe('fleet › trailers view-model', () => {
  it('builds Runtruck1 Trailer rows', () => {
    expect(toTrailerRow(trailer({}))).toEqual({
      unit: 'RF-88',
      kind: 'Reefer · 53 ft',
      status: 'Loaded',
      where: 'En route · I-80',
      ref: { id: 'r', tone: 'blue' },
    });
    expect(toTrailerRow(trailer({ unitNumber: 'FB-12', trailerType: 'flatbed', lengthFt: 48, status: 'inspection' }))).toMatchObject({
      kind: 'Flatbed · 48 ft',
      status: 'Inspection',
      ref: { tone: 'amber' },
    });
    expect(toTrailerRow(trailer({ trailerType: 'dry_van', status: 'empty' }))).toMatchObject({
      kind: 'Dry van · 53 ft',
      status: 'Empty',
      ref: { tone: 'gray' },
    });
  });

  it('formats every location kind', () => {
    expect(formatTrailerLocation({ kind: 'yard', facilityId: 'f', facilityName: 'Sunridge yard', city: 'Modesto' })).toBe('Yard · Modesto');
    expect(formatTrailerLocation({ kind: 'en_route', route: 'I-80' })).toBe('En route · I-80');
    expect(formatTrailerLocation({ kind: 'city', city: 'Bakersfield', state: 'CA' })).toBe('Bakersfield, CA');
  });

  it('builds the KPI row', () => {
    const summary: TrailerListSummary = {
      trailerCount: 8,
      typeCounts: { reefer: 3, dry_van: 3, flatbed: 2 },
      loadedCount: 4,
      rollingCount: 1,
      atShippersCount: 3,
      emptyCount: 3,
      emptyAtYardCount: 2,
      inspectionUnitNumbers: ['FB-12'],
    };
    expect(trailerKpis(summary)).toEqual([
      { label: 'Trailers', value: '8', note: '3 reefer · 3 dry van · 2 flatbed' },
      { label: 'Loaded', value: '4', note: '1 rolling · 3 at shippers' },
      { label: 'Empty', value: '3', note: '2 at the Modesto yard' },
      { label: 'Inspection', value: '1', note: 'FB-12 · annual DOT' },
    ]);
    expect(trailerKpis({ ...summary, inspectionUnitNumbers: [] })[3]?.note).toBe('None pending');
    expect(trailerKpis(undefined).every((k) => k.value === '—' && k.note === undefined)).toBe(true);
  });
});
