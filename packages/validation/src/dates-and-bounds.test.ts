import { describe, expect, it } from 'vitest';
import { businessDateSchema, isoDateSchema } from './common.js';
import { createLoadSchema, type CreateLoadInput } from './loads.js';
import { plannerEventCreateSchema, plannerEventsQuerySchema } from './planner.js';
import { approveSettlementsSchema, listSettlementsQuerySchema } from './settlements.js';

// Input bounds that keep PostgreSQL from answering 500 for values a schema accepted:
// dates PostgreSQL cannot store, integer sums that overflow, unbounded event spans.

const COLOR_CODE = '0b5c7c43-3a52-4e5c-9d0f-6b8b8e6f1a01';

describe('businessDateSchema', () => {
  it('accepts real calendar days within 1900–2999', () => {
    for (const d of ['1900-01-01', '2026-09-03', '2028-02-29', '2999-12-31']) expect(businessDateSchema.safeParse(d).success).toBe(true);
  });

  it('refuses impossible days and years PostgreSQL rejects or no business uses', () => {
    for (const d of ['0000-01-01', '1899-12-31', '3000-01-01', '2026-02-31', '2026-13-01', '2026-9-3', '']) {
      expect(businessDateSchema.safeParse(d).success).toBe(false);
    }
  });

  it('keeps isoDateSchema as the same strict rule', () => {
    expect(isoDateSchema.safeParse('2026-02-31').success).toBe(false);
    expect(isoDateSchema.safeParse('0000-01-01').success).toBe(false);
  });

  it('is used by the planner range, the settlement period and New Load stop dates', () => {
    expect(plannerEventsQuerySchema.safeParse({ from: '0000-01-01', to: '0000-01-02' }).success).toBe(false);
    expect(listSettlementsQuerySchema.safeParse({ periodStart: '0000-01-01' }).success).toBe(false);
    expect(approveSettlementsSchema.safeParse({ periodStart: '2026-08-31' }).success).toBe(true);
    const body = exampleA();
    body.stops[0] = { ...body.stops[0]!, appointmentDate: '0000-01-01' };
    const issues = createLoadSchema.safeParse(body).error?.issues ?? [];
    expect(issues.map((i) => i.path.join('.'))).toContain('stops.0.appointmentDate');
  });
});

// docs/api/loads.md §6.6 worked example A (valid as sent).
function exampleA(): CreateLoadInput & { stops: NonNullable<CreateLoadInput['stops']> } {
  return {
    customerId: '6f1d7a2e-5d7b-4f7e-9a51-2c3a1b0e9d11',
    mode: 'ftl',
    equipmentType: 'reefer_53',
    stops: [
      { kind: 'pickup', facilityName: 'Northgate Cold Storage', addressLine1: '4120 S Golden State Blvd', city: 'Fresno', state: 'ca', postalCode: '93725', appointmentDate: '2026-09-05', windowOpen: '08:00', windowClose: '12:00' },
      { kind: 'delivery', facilityName: 'Reno Grocers DC', addressLine1: '1855 E Greg St', city: 'Sparks', state: 'NV', postalCode: '89431', appointmentDate: '2026-09-06', windowOpen: '06:00' },
    ],
    commodity: 'Frozen produce',
    weightLb: 41_200,
    temperatureF: -10,
    haul: { hauledBy: 'own_fleet', driverId: null, truckId: null, trailerId: null, driverPayCents: 61_200 },
    lineHaulCents: 245_000,
    fuelSurchargeCents: 18_000,
    accessorialCents: 7_500,
    loadedMiles: 478,
    paymentTerms: 'net_30',
  };
}

describe('createLoadSchema total to customer', () => {
  it('accepts worked example A', () => {
    expect(createLoadSchema.safeParse(exampleA()).success).toBe(true);
  });

  it('refuses a total that does not fit an integer, at the line haul field', () => {
    const body = { ...exampleA(), lineHaulCents: 2_147_483_647, fuelSurchargeCents: 1, accessorialCents: 0 };
    const issues = createLoadSchema.safeParse(body).error?.issues ?? [];
    expect(issues.map((i) => [i.path.join('.'), i.message])).toEqual([['lineHaulCents', 'Total to customer is too large.']]);
  });

  it('accepts a total of exactly 2,147,483,647 cents', () => {
    const body = { ...exampleA(), lineHaulCents: 2_147_483_000, fuelSurchargeCents: 600, accessorialCents: 47 };
    expect(createLoadSchema.safeParse(body).success).toBe(true);
  });
});

describe('planner event span', () => {
  const allDay = (date: string, endDate: string) => ({ title: 'Leave', colorCodeId: COLOR_CODE, date, endDate });

  it('allows an all-day event of up to 366 days after its start', () => {
    expect(plannerEventCreateSchema.safeParse(allDay('2026-01-01', '2027-01-02')).success).toBe(true);
  });

  it('refuses a longer span with its own message', () => {
    const issues = plannerEventCreateSchema.safeParse(allDay('2026-01-01', '2027-01-03')).error?.issues ?? [];
    expect(issues.map((i) => [i.path.join('.'), i.message])).toEqual([['endDate', 'An event spans at most a year.']]);
  });
});
