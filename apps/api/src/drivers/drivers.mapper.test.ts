import { describe, expect, it } from 'vitest';
import { type DriverRecord, isHoursAtRisk, summarizeDrivers, toDriverRecord } from './drivers.mapper.js';
import type { DriverSqlRow } from './drivers.repository.js';

const sqlRow = (over: Partial<DriverSqlRow>): DriverSqlRow => ({
  id: 'd1',
  first_name: 'Marcus',
  last_name: 'Hale',
  duty_status: 'on_duty',
  hos_remaining_minutes: 380,
  truck_id: 't1',
  unit_number: 'T-114',
  cdl_expires_on: '2028-04-30',
  pay_ytd: '132600',
  week_miles: 2140,
  load_id: 'l1',
  load_number: 40218,
  load_status: 'in_transit',
  first_pickup_date: '2026-09-02',
  origin_short: 'Fresno',
  destination_short: 'Reno',
  ...over,
});

const PERIOD = { asOf: '2026-09-03', weekStart: '2026-08-31', weekEnd: '2026-09-06', ytdStart: '2026-01-01' };

describe('toDriverRecord', () => {
  it('maps a roster row, converting bigint sums', () => {
    expect(toDriverRecord(sqlRow({}))).toEqual({
      lastName: 'Hale',
      item: {
        id: 'd1',
        fullName: 'Marcus Hale',
        dutyStatus: 'on_duty',
        hosRemainingMinutes: 380,
        truck: { id: 't1', unitNumber: 'T-114' },
        currentLoad: {
          id: 'l1',
          loadNumber: 40218,
          status: 'in_transit',
          firstPickupDate: '2026-09-02',
          originShort: 'Fresno',
          destinationShort: 'Reno',
        },
        cdlExpiresOn: '2028-04-30',
        payYtdCents: 132600,
        weekMiles: 2140,
      },
    });
  });

  it('maps missing truck, load and CDL to null', () => {
    const { item } = toDriverRecord(
      sqlRow({
        truck_id: null,
        unit_number: null,
        load_id: null,
        load_number: null,
        load_status: null,
        first_pickup_date: null,
        cdl_expires_on: null,
        pay_ytd: 0,
      }),
    );
    expect(item).toMatchObject({ truck: null, currentLoad: null, cdlExpiresOn: null, payYtdCents: 0 });
  });
});

describe('hours at risk (fleet.md §2.5: on duty and under 120 minutes)', () => {
  it('counts 119 minutes, not 120, never a missing reading, never an off-duty driver', () => {
    expect(isHoursAtRisk({ dutyStatus: 'on_duty', hosRemainingMinutes: 119 })).toBe(true);
    expect(isHoursAtRisk({ dutyStatus: 'on_duty', hosRemainingMinutes: 0 })).toBe(true);
    expect(isHoursAtRisk({ dutyStatus: 'on_duty', hosRemainingMinutes: 120 })).toBe(false);
    expect(isHoursAtRisk({ dutyStatus: 'on_duty', hosRemainingMinutes: null })).toBe(false);
    expect(isHoursAtRisk({ dutyStatus: 'available', hosRemainingMinutes: 30 })).toBe(false);
    expect(isHoursAtRisk({ dutyStatus: 'home_time', hosRemainingMinutes: 30 })).toBe(false);
  });
});

describe('summarizeDrivers', () => {
  const seed: DriverRecord[] = [
    toDriverRecord(sqlRow({})),
    toDriverRecord(sqlRow({ id: 'd2', first_name: 'Dara', last_name: 'Whitfield', hos_remaining_minutes: 545, week_miles: 1980 })),
    toDriverRecord(sqlRow({ id: 'd3', first_name: 'Ellis', last_name: 'Nakamura', hos_remaining_minutes: 105, week_miles: 1760 })),
    toDriverRecord(
      sqlRow({ id: 'd4', first_name: 'Priya', last_name: 'Raman', duty_status: 'available', hos_remaining_minutes: 660, week_miles: 1420 }),
    ),
    toDriverRecord(
      sqlRow({ id: 'd5', first_name: 'Ana', last_name: 'Cortez', duty_status: 'available', hos_remaining_minutes: 660, week_miles: 1180 }),
    ),
    toDriverRecord(
      sqlRow({ id: 'd6', first_name: 'Tobias', last_name: 'Frey', duty_status: 'home_time', hos_remaining_minutes: null, week_miles: 640 }),
    ),
  ];

  it('reproduces the seeded KPI figures', () => {
    expect(summarizeDrivers(seed, PERIOD)).toEqual({
      ...PERIOD,
      rosterCount: 6,
      onDutyCount: 3,
      availableCount: 2,
      homeTimeCount: 1,
      hoursAtRisk: [{ driverId: 'd3', fullName: 'Ellis Nakamura', lastName: 'Nakamura', hosRemainingMinutes: 105 }],
      totalWeekMiles: 9120,
      maxWeekMiles: 2140,
    });
  });

  it('keeps roster order for several drivers at risk and handles an empty roster', () => {
    const risky = [
      toDriverRecord(sqlRow({ id: 'a', last_name: 'Zed', hos_remaining_minutes: 10 })),
      toDriverRecord(sqlRow({ id: 'b', last_name: 'Abe', hos_remaining_minutes: 100 })),
    ];
    expect(summarizeDrivers(risky, PERIOD).hoursAtRisk.map((d) => d.lastName)).toEqual(['Zed', 'Abe']);
    expect(summarizeDrivers([], PERIOD)).toMatchObject({
      rosterCount: 0,
      homeTimeCount: 0,
      hoursAtRisk: [],
      totalWeekMiles: 0,
      maxWeekMiles: 0,
    });
  });
});
