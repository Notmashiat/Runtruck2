import { driverKpis, formatInt, toDriverRow, toTrailerRow, toTruckRow, trailerKpis, truckKpis } from '@runtruck/calculations';
import type { DriverListItem, DriverListMeta, TrailerListItem, TrailerListMeta, TruckListItem, TruckListMeta } from '@runtruck/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matchesQuery } from '../src/common/list/list-query.js';
import { createTestContext, type TestContext } from './helpers.js';

// Fleet read views (docs/api/fleet.md §7): GET /drivers, /trucks, /trailers against the
// demo seed, plus authentication, permissions, tenancy and validation.

let t: TestContext;
let admin: Awaited<ReturnType<TestContext['as']>>;
beforeAll(async () => {
  t = await createTestContext();
  admin = await t.as('admin');
});
afterAll(async () => {
  await t.close();
});

interface Envelope<T, M> {
  data: T;
  meta: M;
}

async function get<T, M>(path: string, agent = admin): Promise<Envelope<T, M>> {
  const res = await agent.get(`/api/v1${path}`).expect(200);
  return res.body as Envelope<T, M>;
}

const SUNRIDGE_DRIVERS = ['Marcus Hale', 'Dara Whitfield', 'Ellis Nakamura', 'Priya Raman', 'Ana Cortez', 'Tobias Frey'];

describe('GET /drivers', () => {
  it('returns the seeded roster in Runtruck1 order with the computed facts (fleet.md §2.6)', async () => {
    const { data, meta } = await get<DriverListItem[], DriverListMeta>('/drivers?limit=500');
    expect(
      data.map((d) => [
        d.fullName,
        d.dutyStatus,
        d.truck?.unitNumber ?? null,
        d.currentLoad && [
          d.currentLoad.loadNumber,
          d.currentLoad.status,
          d.currentLoad.firstPickupDate,
          d.currentLoad.originShort,
          d.currentLoad.destinationShort,
        ],
        d.hosRemainingMinutes,
        d.cdlExpiresOn,
        d.payYtdCents,
        d.weekMiles,
      ]),
    ).toEqual([
      ['Marcus Hale', 'on_duty', 'T-114', [40218, 'in_transit', '2026-09-03', 'Fresno', 'Reno'], 380, '2028-04-30', 132600, 2140],
      ['Dara Whitfield', 'on_duty', 'T-107', [40219, 'at_pickup', '2026-09-03', 'Stockton', 'SLC'], 545, '2027-11-30', 118800, 1980],
      ['Ellis Nakamura', 'on_duty', 'T-121', [40220, 'delayed', '2026-09-02', 'Sacramento', 'Boise'], 105, '2027-02-28', 145500, 1760],
      ['Priya Raman', 'available', 'T-103', null, 660, '2026-07-31', 82400, 1420],
      ['Ana Cortez', 'available', 'T-109', [40222, 'dispatched', '2026-09-05', 'Redding', 'Seattle'], 660, '2029-09-30', 68400, 1180],
      ['Tobias Frey', 'home_time', 'T-118', null, null, '2028-01-31', 0, 640],
    ]);
    expect(meta).toMatchObject({ total: 6, limit: 500, offset: 0 });
    expect(meta.summary).toEqual({
      asOf: '2026-09-03',
      weekStart: '2026-08-31',
      weekEnd: '2026-09-06',
      ytdStart: '2026-01-01',
      rosterCount: 6,
      onDutyCount: 3,
      availableCount: 2,
      homeTimeCount: 1,
      hoursAtRisk: [{ driverId: data[2]?.id, fullName: 'Ellis Nakamura', lastName: 'Nakamura', hosRemainingMinutes: 105 }],
      totalWeekMiles: 9120,
      maxWeekMiles: 2140,
    });
  });

  it('renders exactly the Runtruck1 roster strings through the shared view-model (pay differs, D5)', async () => {
    const { data } = await get<DriverListItem[], DriverListMeta>('/drivers?limit=500');
    expect(data.map((d) => Object.values({ ...toDriverRow(d), ref: undefined }).slice(0, 8))).toEqual([
      ['Marcus Hale', 'On duty', 'T-114', 'L-40218 · Fresno → Reno', '6h 20m', '04/2028', '$1,326', 2140],
      ['Dara Whitfield', 'On duty', 'T-107', 'L-40219 · Stockton → SLC', '9h 05m', '11/2027', '$1,188', 1980],
      ['Ellis Nakamura', 'On duty', 'T-121', 'L-40220 · Sacramento → Boise', '1h 45m', '02/2027', '$1,455', 1760],
      ['Priya Raman', 'Available', 'T-103', '—', '11h 00m', '07/2026', '$824', 1420],
      ['Ana Cortez', 'Available', 'T-109', 'L-40222 · Sep 5', '11h 00m', '09/2029', '$684', 1180],
      ['Tobias Frey', 'Home time', 'T-118', '—', '—', '01/2028', '$0', 640],
    ]);
  });

  it('filters q over the view-model strings exactly as the web does; the summary ignores q', async () => {
    const all = await get<DriverListItem[], DriverListMeta>('/drivers?limit=500');
    for (const q of ['2140', '—', 'on duty', 'sep 5', 'SLC', '$1,4', 'nobody']) {
      const res = await get<DriverListItem[], DriverListMeta>(`/drivers?limit=500&q=${encodeURIComponent(q)}`);
      const expected = all.data.filter((d) => matchesQuery(toDriverRow(d), q)).map((d) => d.fullName);
      expect(
        res.data.map((d) => d.fullName),
        q,
      ).toEqual(expected);
      expect(res.meta.total).toBe(expected.length);
      expect(res.meta.summary).toEqual(all.meta.summary);
    }
    expect((await get<DriverListItem[], DriverListMeta>('/drivers?q=2140')).data.map((d) => d.fullName)).toEqual(['Marcus Hale']);
    expect((await get<DriverListItem[], DriverListMeta>('/drivers?q=%E2%80%94')).data.map((d) => d.fullName)).toEqual([
      'Priya Raman',
      'Tobias Frey',
    ]);
    // Ids and enum values are never searched.
    expect((await get<DriverListItem[], DriverListMeta>(`/drivers?q=${all.data[0]?.id ?? ''}`)).meta.total).toBe(0);
    expect((await get<DriverListItem[], DriverListMeta>('/drivers?q=on_duty')).meta.total).toBe(0);
  });

  it('filters by the duty pill without changing the summary', async () => {
    const all = await get<DriverListItem[], DriverListMeta>('/drivers');
    const onDuty = await get<DriverListItem[], DriverListMeta>('/drivers?dutyStatus=on_duty');
    expect(onDuty.data.map((d) => d.fullName)).toEqual(['Marcus Hale', 'Dara Whitfield', 'Ellis Nakamura']);
    expect(onDuty.meta.total).toBe(3);
    expect(onDuty.meta.summary).toEqual(all.meta.summary);
    const available = await get<DriverListItem[], DriverListMeta>('/drivers?dutyStatus=available&q=ana');
    expect(available.data.map((d) => d.fullName)).toEqual(['Ana Cortez']);
  });

  it('pages with limit and offset; total counts every match', async () => {
    const page = await get<DriverListItem[], DriverListMeta>('/drivers?limit=2&offset=1');
    expect(page.data.map((d) => d.fullName)).toEqual(['Dara Whitfield', 'Ellis Nakamura']);
    expect(page.meta).toMatchObject({ total: 6, limit: 2, offset: 1 });
    expect((await get<DriverListItem[], DriverListMeta>('/drivers?offset=10')).data).toEqual([]);
    expect((await get<DriverListItem[], DriverListMeta>('/drivers')).meta.limit).toBe(100);
  });
});

describe('GET /trucks', () => {
  it('returns the seeded units by unit number with the summary (fleet.md §3.4–§3.5)', async () => {
    const { data, meta } = await get<TruckListItem[], TruckListMeta>('/trucks?limit=500');
    expect(
      data.map((x) => [
        x.unitNumber,
        x.make,
        x.model,
        x.modelYear,
        `${x.plateState} ${x.plateNumber}`,
        x.assignedDriver?.fullName ?? null,
        x.odometerMiles,
        x.nextServiceMiles,
        x.status,
      ]),
    ).toEqual([
      ['T-103', 'Freightliner', 'Cascadia', 2022, 'CA 8HJ2019', 'Priya Raman', 318440, 342000, 'in_service'],
      ['T-107', 'Volvo', 'VNL 760', 2021, 'CA 7RD8842', 'Dara Whitfield', 402190, 425000, 'in_service'],
      ['T-109', 'Kenworth', 'T680', 2023, 'CA 9KM1174', 'Ana Cortez', 141220, 165000, 'in_service'],
      ['T-114', 'Peterbilt', '579', 2020, 'CA 6PL4408', 'Marcus Hale', 528900, 529800, 'service_due'],
      ['T-118', 'Freightliner', 'Cascadia', 2019, 'CA 5TT9930', 'Tobias Frey', 611780, null, 'in_shop'],
      ['T-121', 'International', 'LT', 2022, 'CA 8WQ2251', 'Ellis Nakamura', 275610, 298000, 'in_service'],
    ]);
    expect(meta).toMatchObject({ total: 6, limit: 500, offset: 0 });
    expect(meta.summary).toEqual({
      truckCount: 6,
      averageOdometerMiles: 379690,
      inServiceCount: 4,
      inShopUnitNumbers: ['T-118'],
      serviceDue: [{ truckId: data[3]?.id, unitNumber: 'T-114', milesUntilService: 900 }],
    });
    expect(data.map((x) => toTruckRow(x).make)).toContain('Peterbilt 579 · 2020');
  });

  it('matches q on comma-formatted strings only, as the web does', async () => {
    const all = await get<TruckListItem[], TruckListMeta>('/trucks?limit=500');
    for (const q of ['318,440', '318440', 'in shop', 'marcus', '·', 'ca 9']) {
      const res = await get<TruckListItem[], TruckListMeta>(`/trucks?q=${encodeURIComponent(q)}`);
      expect(
        res.data.map((x) => x.unitNumber),
        q,
      ).toEqual(all.data.filter((x) => matchesQuery(toTruckRow(x), q)).map((x) => x.unitNumber));
      expect(res.meta.summary).toEqual(all.meta.summary);
    }
    expect((await get<TruckListItem[], TruckListMeta>('/trucks?q=318%2C440')).data.map((x) => x.unitNumber)).toEqual(['T-103']);
    expect((await get<TruckListItem[], TruckListMeta>('/trucks?q=318440')).meta.total).toBe(0);
  });

  it('pages', async () => {
    const page = await get<TruckListItem[], TruckListMeta>('/trucks?limit=1&offset=5');
    expect(page.data.map((x) => x.unitNumber)).toEqual(['T-121']);
    expect(page.meta.total).toBe(6);
  });
});

describe('GET /trailers', () => {
  it('returns the seeded trailers in hand-authored order with the summary (fleet.md §4.4–§4.5)', async () => {
    const { data, meta } = await get<TrailerListItem[], TrailerListMeta>('/trailers?limit=500');
    expect(data.map((x) => [x.unitNumber, x.trailerType, x.lengthFt, x.status])).toEqual([
      ['RF-27', 'reefer', 53, 'loaded'],
      ['RF-09', 'reefer', 53, 'empty'],
      ['RF-88', 'reefer', 53, 'loaded'],
      ['DV-51', 'dry_van', 53, 'loaded'],
      ['DV-88', 'dry_van', 53, 'empty'],
      ['DV-14', 'dry_van', 53, 'empty'],
      ['FB-04', 'flatbed', 48, 'loaded'],
      ['FB-12', 'flatbed', 48, 'inspection'],
    ]);
    expect(data[0]?.location).toEqual({ kind: 'city', city: 'Bakersfield', state: 'CA' });
    expect(data[1]?.location).toMatchObject({ kind: 'yard', facilityName: 'Sunridge yard', city: 'Modesto' });
    expect(data[2]?.location).toEqual({ kind: 'en_route', route: 'I-80' });
    expect(data.map((x) => toTrailerRow(x).where)).toEqual([
      'Bakersfield, CA',
      'Yard · Modesto',
      'En route · I-80',
      'Stockton, CA',
      'Yard · Modesto',
      'Las Vegas, NV',
      'Redding, CA',
      'Yard · Modesto',
    ]);
    expect(meta).toMatchObject({ total: 8, limit: 500, offset: 0 });
    expect(meta.summary).toEqual({
      trailerCount: 8,
      typeCounts: { reefer: 3, dry_van: 3, flatbed: 2 },
      loadedCount: 4,
      rollingCount: 1,
      atShippersCount: 3,
      emptyCount: 3,
      emptyAtYardCount: 2,
      inspectionUnitNumbers: ['FB-12'],
    });
  });

  it('matches q over the view-model strings; the summary ignores q', async () => {
    const all = await get<TrailerListItem[], TrailerListMeta>('/trailers?limit=500');
    const yard = await get<TrailerListItem[], TrailerListMeta>('/trailers?q=yard');
    expect(yard.data.map((x) => x.unitNumber)).toEqual(['RF-09', 'DV-88', 'FB-12']);
    expect(yard.meta).toMatchObject({ total: 3 });
    expect(yard.meta.summary).toEqual(all.meta.summary);
    for (const q of ['reefer · 53', '48 ft', 'loaded', 'nv']) {
      const res = await get<TrailerListItem[], TrailerListMeta>(`/trailers?q=${encodeURIComponent(q)}`);
      expect(
        res.data.map((x) => x.unitNumber),
        q,
      ).toEqual(all.data.filter((x) => matchesQuery(toTrailerRow(x), q)).map((x) => x.unitNumber));
    }
  });
});

// What the three tabs render for the seed, built from the API response with the same
// builders and expressions as the web (fleet.md §5): every string equals Runtruck1's
// DRIVERS / TRUCKS / TRAILERS and KPI rows, except Pay YTD (D5, fleet.md §8).
describe('rendered strings against Runtruck1 (fleet.md §5)', () => {
  it('Drivers: KPIs, miles card and bars', async () => {
    const { data, meta } = await get<DriverListItem[], DriverListMeta>('/drivers?limit=500');
    // "Docs to renew" is meta.total of GET /compliance-reminders (4 for the seed, safety.md §7.3).
    expect(driverKpis(meta.summary, 4)).toEqual([
      { label: 'On the roster', value: '6', note: '3 on duty · 1 home time' },
      { label: 'Available now', value: '2', note: 'Both reset today' },
      { label: 'Hours at risk', value: '1', note: 'Nakamura · 1h 45m' },
      { label: 'Docs to renew', value: '4', note: 'On the watchlist below' },
    ]);
    expect(`${formatInt(meta.summary.totalWeekMiles)} mi total`).toBe('9,120 mi total');
    const max = meta.summary.maxWeekMiles;
    expect(
      data.map((d) => [d.fullName, `${Math.round((d.weekMiles / max) * 100)}%`, d.weekMiles === max ? 1 : 0.55, formatInt(d.weekMiles)]),
    ).toEqual([
      ['Marcus Hale', '100%', 1, '2,140'],
      ['Dara Whitfield', '93%', 0.55, '1,980'],
      ['Ellis Nakamura', '82%', 0.55, '1,760'],
      ['Priya Raman', '66%', 0.55, '1,420'],
      ['Ana Cortez', '55%', 0.55, '1,180'],
      ['Tobias Frey', '30%', 0.55, '640'],
    ]);
    // Pill counts: All 6, On duty 3, Available 2 (fleet-hr-safety §3.3).
    const rows = data.map(toDriverRow);
    expect(['On duty', 'Available'].map((pill) => rows.filter((r) => r.status === pill).length)).toEqual([3, 2]);
    expect(rows.map((r) => r.ref.tone)).toEqual(['blue', 'blue', 'blue', 'gray', 'gray', 'gray']);
  });

  it('Trucks: every row and KPI', async () => {
    const { data, meta } = await get<TruckListItem[], TruckListMeta>('/trucks?limit=500');
    expect(data.map(toTruckRow).map(({ ref, ...row }) => ({ ...row, tone: ref.tone }))).toEqual([
      {
        unit: 'T-103',
        make: 'Freightliner Cascadia · 2022',
        plate: 'CA 8HJ2019',
        driver: 'Priya Raman',
        odo: '318,440',
        service: '342,000',
        status: 'In service',
        tone: 'blue',
      },
      {
        unit: 'T-107',
        make: 'Volvo VNL 760 · 2021',
        plate: 'CA 7RD8842',
        driver: 'Dara Whitfield',
        odo: '402,190',
        service: '425,000',
        status: 'In service',
        tone: 'blue',
      },
      {
        unit: 'T-109',
        make: 'Kenworth T680 · 2023',
        plate: 'CA 9KM1174',
        driver: 'Ana Cortez',
        odo: '141,220',
        service: '165,000',
        status: 'In service',
        tone: 'blue',
      },
      {
        unit: 'T-114',
        make: 'Peterbilt 579 · 2020',
        plate: 'CA 6PL4408',
        driver: 'Marcus Hale',
        odo: '528,900',
        service: '529,800',
        status: 'Service due',
        tone: 'amber',
      },
      {
        unit: 'T-118',
        make: 'Freightliner Cascadia · 2019',
        plate: 'CA 5TT9930',
        driver: 'Tobias Frey',
        odo: '611,780',
        service: '—',
        status: 'In shop',
        tone: 'amber',
      },
      {
        unit: 'T-121',
        make: 'International LT · 2022',
        plate: 'CA 8WQ2251',
        driver: 'Ellis Nakamura',
        odo: '275,610',
        service: '298,000',
        status: 'In service',
        tone: 'blue',
      },
    ]);
    expect(truckKpis(meta.summary)).toEqual([
      { label: 'Power units', value: '6', note: 'Avg 380K mi' },
      { label: 'In service', value: '4', note: 'Of 6 units' },
      { label: 'In shop', value: '1', note: 'T-118 · turbo' },
      { label: 'Service due', value: '1', note: 'T-114 in 900 mi' },
    ]);
  });

  it('Trailers: every row and KPI', async () => {
    const { data, meta } = await get<TrailerListItem[], TrailerListMeta>('/trailers?limit=500');
    expect(data.map(toTrailerRow).map(({ ref, ...row }) => ({ ...row, tone: ref.tone }))).toEqual([
      { unit: 'RF-27', kind: 'Reefer · 53 ft', status: 'Loaded', where: 'Bakersfield, CA', tone: 'blue' },
      { unit: 'RF-09', kind: 'Reefer · 53 ft', status: 'Empty', where: 'Yard · Modesto', tone: 'gray' },
      { unit: 'RF-88', kind: 'Reefer · 53 ft', status: 'Loaded', where: 'En route · I-80', tone: 'blue' },
      { unit: 'DV-51', kind: 'Dry van · 53 ft', status: 'Loaded', where: 'Stockton, CA', tone: 'blue' },
      { unit: 'DV-88', kind: 'Dry van · 53 ft', status: 'Empty', where: 'Yard · Modesto', tone: 'gray' },
      { unit: 'DV-14', kind: 'Dry van · 53 ft', status: 'Empty', where: 'Las Vegas, NV', tone: 'gray' },
      { unit: 'FB-04', kind: 'Flatbed · 48 ft', status: 'Loaded', where: 'Redding, CA', tone: 'blue' },
      { unit: 'FB-12', kind: 'Flatbed · 48 ft', status: 'Inspection', where: 'Yard · Modesto', tone: 'amber' },
    ]);
    expect(trailerKpis(meta.summary)).toEqual([
      { label: 'Trailers', value: '8', note: '3 reefer · 3 dry van · 2 flatbed' },
      { label: 'Loaded', value: '4', note: '1 rolling · 3 at shippers' },
      { label: 'Empty', value: '3', note: '2 at the Modesto yard' },
      { label: 'Inspection', value: '1', note: 'FB-12 · annual DOT' },
    ]);
  });
});

describe('fleet access control', () => {
  const PATHS = ['/drivers', '/trucks', '/trailers'];

  it('requires a session', async () => {
    for (const path of PATHS) {
      const res = await request(t.server).get(`/api/v1${path}`).expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('refuses members without the view permission', async () => {
    const driver = await t.as('driver');
    for (const path of PATHS) {
      const res = await driver.get(`/api/v1${path}`).expect(403);
      expect(res.body.error).toMatchObject({ code: 'FORBIDDEN' });
      expect(res.body.error.requestId).toBeTruthy();
    }
    // Accounting holds drivers.view (payroll) but not trucks.view or trailers.view.
    const accounting = await t.as('accounting');
    await accounting.get('/api/v1/drivers').expect(200);
    await accounting.get('/api/v1/trucks').expect(403);
    await accounting.get('/api/v1/trailers').expect(403);
    // The Dispatcher holds all three.
    const dispatcher = await t.as('dispatcher');
    for (const path of PATHS) await dispatcher.get(`/api/v1${path}`).expect(200);
  });

  it('shows another organization only its own fleet', async () => {
    const other = await t.as('otherAdmin');
    const drivers = await get<DriverListItem[], DriverListMeta>('/drivers?limit=500', other);
    expect(drivers.data.map((d) => d.fullName)).toEqual(['Terry Wheeler']);
    expect(drivers.data[0]).toMatchObject({
      dutyStatus: 'on_duty',
      truck: { unitNumber: 'TC-01' },
      currentLoad: { loadNumber: 50001, status: 'in_transit', originShort: 'Dallas', destinationShort: 'Houston' },
      cdlExpiresOn: '2028-05-31',
      payYtdCents: 49500,
      weekMiles: 900,
    });
    expect(drivers.meta.summary).toMatchObject({ rosterCount: 1, onDutyCount: 1, hoursAtRisk: [], totalWeekMiles: 900 });
    expect(drivers.data.some((d) => SUNRIDGE_DRIVERS.includes(d.fullName))).toBe(false);
    expect((await get<DriverListItem[], DriverListMeta>('/drivers?q=marcus', other)).meta.total).toBe(0);

    const trucks = await get<TruckListItem[], TruckListMeta>('/trucks?limit=500', other);
    expect(trucks.data.map((x) => x.unitNumber)).toEqual(['TC-01']);
    expect(trucks.data[0]?.assignedDriver?.fullName).toBe('Terry Wheeler');
    expect(trucks.meta.summary.truckCount).toBe(1);

    const trailers = await get<TrailerListItem[], TrailerListMeta>('/trailers?limit=500', other);
    expect(trailers.data.map((x) => x.unitNumber)).toEqual(['TC-T1']);
    expect(trailers.meta.summary.trailerCount).toBe(1);
  });
});

describe('fleet query validation', () => {
  it.each([
    ['/drivers?limit=0', 'limit'],
    ['/drivers?limit=501', 'limit'],
    ['/drivers?limit=abc', 'limit'],
    ['/drivers?offset=-1', 'offset'],
    ['/drivers?offset=1.5', 'offset'],
    ['/drivers?offset=1e20', 'offset'],
    [`/drivers?q=${'x'.repeat(201)}`, 'q'],
    ['/drivers?dutyStatus=driving', 'dutyStatus'],
    ['/trucks?limit=501', 'limit'],
    ['/trucks?offset=-5', 'offset'],
    ['/trailers?limit=0', 'limit'],
    [`/trailers?q=${'y'.repeat(201)}`, 'q'],
  ])('%s is a 400 naming %s', async (path, param) => {
    const res = await admin.get(`/api/v1${path}`).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.issues.map((i: { path: string }) => i.path)).toContain(param);
  });

  it('accepts a 200-character q and ignores unknown parameters', async () => {
    await admin.get(`/api/v1/drivers?q=${'x'.repeat(200)}&unknown=1`).expect(200);
  });
});
