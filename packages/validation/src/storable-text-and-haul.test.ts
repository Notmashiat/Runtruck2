import { describe, expect, it } from 'vitest';
import { loginSchema } from './auth.js';
import { isStorableText, pageQuerySchema, UNSTORABLE_TEXT_MESSAGE } from './common.js';
import { createLoadSchema, type CreateLoadInput } from './loads.js';
import {
  plannerColorCodeCreateSchema,
  plannerColorCodeUpdateSchema,
  plannerEventCreateSchema,
  plannerEventUpdateSchema,
} from './planner.js';

const COLOR_CODE = '0b5c7c43-3a52-4e5c-9d0f-6b8b8e6f1a01';
const NUL = '\u0000';
const LONE_HIGH = '\uD800';
const LONE_LOW = '\uDC00';

// docs/api/loads.md §6.6 worked example A (valid as sent).
function exampleA(): CreateLoadInput & { stops: NonNullable<CreateLoadInput['stops']> } {
  return {
    customerId: '6f1d7a2e-5d7b-4f7e-9a51-2c3a1b0e9d11',
    mode: 'ftl',
    equipmentType: 'reefer_53',
    stops: [
      {
        kind: 'pickup',
        facilityName: 'Northgate Cold Storage',
        addressLine1: '4120 S Golden State Blvd',
        city: 'Fresno',
        state: 'ca',
        appointmentDate: '2026-09-05',
      },
      {
        kind: 'delivery',
        facilityName: 'Reno Grocers DC',
        addressLine1: '1855 E Greg St',
        city: 'Sparks',
        state: 'NV',
        appointmentDate: '2026-09-06',
      },
    ],
    commodity: 'Frozen produce',
    weightLb: 41_200,
    haul: { hauledBy: 'own_fleet', driverId: null, truckId: null, trailerId: null, driverPayCents: 61_200 },
    lineHaulCents: 245_000,
    paymentTerms: 'net_30',
  };
}

const issuesOf = (result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  (result.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]);

describe('isStorableText (NUL and lone surrogates)', () => {
  it('accepts ordinary text, astral characters and CJK', () => {
    for (const s of ['', 'Frozen produce', 'Café 東京 🚚', '🚚', 'tab\tand\nnewline']) expect(isStorableText(s)).toBe(true);
  });

  it('refuses U+0000 and unpaired surrogates anywhere in the string', () => {
    for (const s of [NUL, `a${NUL}b`, LONE_HIGH, `x${LONE_HIGH}y`, `${LONE_LOW}x`, `x${LONE_LOW}`, `${LONE_LOW}${LONE_HIGH}`, `\uD83D`]) {
      expect(isStorableText(s)).toBe(false);
    }
  });
});

describe('free-text inputs refuse text PostgreSQL cannot store', () => {
  it('New Load text fields, the stop state and nested stop fields', () => {
    for (const patch of [
      { commodity: `Frozen${NUL}produce` },
      { driverInstructions: `gate${NUL}3` },
      { commodity: `x${LONE_HIGH}y` },
      { internalNotes: `note${LONE_LOW}` },
    ]) {
      const result = createLoadSchema.safeParse({ ...exampleA(), ...patch });
      expect(issuesOf(result)).toEqual([[Object.keys(patch)[0], UNSTORABLE_TEXT_MESSAGE]]);
    }
    const body = exampleA();
    body.stops[0] = { ...body.stops[0]!, state: `C${NUL}` };
    body.stops[1] = { ...body.stops[1]!, facilityName: `Reno${LONE_HIGH}` };
    const paths = issuesOf(createLoadSchema.safeParse(body)).map(([p]) => p);
    expect(paths).toEqual(expect.arrayContaining(['stops.0.state', 'stops.1.facilityName']));
  });

  it('planner title, place, notes, people and color-code labels', () => {
    const event = { title: 'Standup', colorCodeId: COLOR_CODE, date: '2026-09-03' };
    expect(issuesOf(plannerEventCreateSchema.safeParse({ ...event, title: `Stand${NUL}up` }))).toEqual([
      ['title', UNSTORABLE_TEXT_MESSAGE],
    ]);
    expect(issuesOf(plannerEventCreateSchema.safeParse({ ...event, title: `Stand${LONE_HIGH}up` }))).toEqual([
      ['title', UNSTORABLE_TEXT_MESSAGE],
    ]);
    expect(issuesOf(plannerEventCreateSchema.safeParse({ ...event, place: `Fresno${NUL}` }))).toEqual([['place', UNSTORABLE_TEXT_MESSAGE]]);
    expect(issuesOf(plannerEventCreateSchema.safeParse({ ...event, notes: `x${LONE_LOW}` }))).toEqual([['notes', UNSTORABLE_TEXT_MESSAGE]]);
    expect(issuesOf(plannerEventCreateSchema.safeParse({ ...event, people: ['Ann', `A${NUL}B`] }))).toEqual([
      ['people.1', UNSTORABLE_TEXT_MESSAGE],
    ]);
    expect(issuesOf(plannerEventUpdateSchema.safeParse({ title: `a${NUL}` }))).toEqual([['title', UNSTORABLE_TEXT_MESSAGE]]);
    expect(issuesOf(plannerColorCodeCreateSchema.safeParse({ label: `Bad${NUL}label` }))).toEqual([['label', UNSTORABLE_TEXT_MESSAGE]]);
    expect(issuesOf(plannerColorCodeUpdateSchema.safeParse({ label: `x${LONE_LOW}` }))).toEqual([['label', UNSTORABLE_TEXT_MESSAGE]]);
    expect(plannerEventCreateSchema.safeParse({ ...event, title: 'Stand-up 🚚 東京' }).success).toBe(true);
  });

  it('the list search q and the sign-in email', () => {
    expect(issuesOf(pageQuerySchema.safeParse({ q: `a${NUL}b` }))).toEqual([['q', UNSTORABLE_TEXT_MESSAGE]]);
    expect(pageQuerySchema.safeParse({ q: `a${LONE_HIGH}` }).success).toBe(false);
    expect(loginSchema.safeParse({ email: `rosa${NUL}@example.com`, password: 'x' }).success).toBe(false);
  });
});

describe('New Load haul kinds take only their own fields (09 §3.1 E3)', () => {
  it('refuses partner-carrier fields on an own-fleet haul, one issue per field', () => {
    const body = {
      ...exampleA(),
      haul: {
        hauledBy: 'own_fleet',
        driverId: null,
        truckId: null,
        trailerId: null,
        driverPayCents: null,
        carrierRateCents: 150_000,
        driverName: 'Bob Smith',
        carrierId: '00000000-0000-4000-8000-000000000001',
      },
    } as unknown as CreateLoadInput;
    expect(issuesOf(createLoadSchema.safeParse(body))).toEqual([
      ['haul.carrierRateCents', 'This field is for partner-carrier loads, not own-fleet loads.'],
      ['haul.driverName', 'This field is for partner-carrier loads, not own-fleet loads.'],
      ['haul.carrierId', 'This field is for partner-carrier loads, not own-fleet loads.'],
    ]);
  });

  it('refuses own-fleet fields and unknown fields on a partner-carrier haul', () => {
    const body = {
      ...exampleA(),
      haul: {
        hauledBy: 'partner_carrier',
        carrierId: '00000000-0000-4000-8000-000000000002',
        carrierRateCents: 50_000,
        driverId: '00000000-0000-4000-8000-000000000003',
        driverPayCents: 61_200,
        color: 'red',
      },
    } as unknown as CreateLoadInput;
    expect(issuesOf(createLoadSchema.safeParse(body))).toEqual([
      ['haul.driverId', 'This field is for own-fleet loads, not partner-carrier loads.'],
      ['haul.driverPayCents', 'This field is for own-fleet loads, not partner-carrier loads.'],
      ['haul.color', 'This field is not part of a haul.'],
    ]);
  });

  it("still lists Runtruck1's rules next to a foreign field", () => {
    const body = { ...exampleA(), commodity: null, haul: { hauledBy: 'own_fleet', carrierRateCents: 1 } } as unknown as CreateLoadInput;
    expect(issuesOf(createLoadSchema.safeParse(body))).toEqual([
      ['haul.carrierRateCents', 'This field is for partner-carrier loads, not own-fleet loads.'],
      ['commodity', 'Commodity'],
    ]);
  });

  it('accepts each kind with exactly its own fields', () => {
    expect(createLoadSchema.safeParse(exampleA()).success).toBe(true);
    const partner = {
      ...exampleA(),
      haul: {
        hauledBy: 'partner_carrier',
        carrierId: '00000000-0000-4000-8000-000000000002',
        carrierRateCents: 50_000,
        driverName: 'Bob',
        truckNumber: '12',
        trailerNumber: null,
      },
    } as CreateLoadInput;
    const parsed = createLoadSchema.parse(partner);
    expect(parsed.haul).toEqual({
      hauledBy: 'partner_carrier',
      carrierId: '00000000-0000-4000-8000-000000000002',
      carrierRateCents: 50_000,
      carrierContactName: null,
      carrierPhone: null,
      driverName: 'Bob',
      truckNumber: '12',
      trailerNumber: null,
    });
  });

  it('keeps refusing an unknown or missing haul kind', () => {
    for (const haul of [{ hauledBy: 'rail' }, {}, null, 'own_fleet']) {
      const result = createLoadSchema.safeParse({ ...exampleA(), haul });
      expect(result.success).toBe(false);
      expect(issuesOf(result).some(([p]) => p === 'haul' || p === 'haul.hauledBy')).toBe(true);
    }
  });
});
