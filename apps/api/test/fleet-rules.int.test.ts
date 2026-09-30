import { toDriverRow } from '@runtruck/calculations';
import { schema } from '@runtruck/database';
import type { DriverListItem, DriverListMeta } from '@runtruck/types';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './helpers.js';

// The computed roster facts of GET /drivers against records written for the purpose
// (docs/api/fleet.md §2.2, §7): current-load tiers and tie-breaks, first-pickup /
// last-delivery choice, and the YTD and org-week boundaries. This file writes to its
// own freshly seeded database (createTestContext), so the seed assertions of
// fleet.int.test.ts are unaffected.

let t: TestContext;
let admin: Awaited<ReturnType<TestContext['as']>>;
let org: string;
let customerId: string;
const facility: Record<string, string> = {};
const driverId: Record<string, string> = {};

beforeAll(async () => {
  t = await createTestContext();
  admin = await t.as('admin');
  org = t.orgs.demoOrganizationId;
  const db = t.db.db;
  const [customer] = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(and(eq(schema.customers.organizationId, org), eq(schema.customers.name, 'Cascade Building Supply')));
  customerId = customer?.id ?? '';
  for (const f of await db
    .select({ id: schema.facilities.id, name: schema.facilities.name })
    .from(schema.facilities)
    .where(eq(schema.facilities.organizationId, org))) {
    facility[f.name] = f.id;
  }
  for (const d of await roster()) driverId[d.fullName] = d.id;
});
afterAll(async () => {
  await t.close();
});

async function roster(): Promise<DriverListItem[]> {
  const res = await admin.get('/api/v1/drivers?limit=500').expect(200);
  return (res.body as { data: DriverListItem[] }).data;
}

async function currentLoadOf(name: string): Promise<string> {
  const row = (await roster()).find((d) => d.fullName === name);
  if (!row) throw new Error(`${name} missing`);
  return toDriverRow(row).load;
}

type StopSpec = { kind: 'pickup' | 'delivery' | 'fuel'; facility?: string; city?: string; date: string };

const CITY_OF: Record<string, [string, string]> = {
  'Cascade Mill': ['Redding', 'CA'],
  'Duwamish Steel Yard': ['Seattle', 'WA'],
  'Wasatch Crossdock': ['Salt Lake City', 'UT'],
  'Reno Grocers DC': ['Sparks', 'NV'],
};

// Writes a board (or archived) load with its stops and a dispatch to `driver`.
async function addLoad(spec: {
  loadNumber: number;
  status: 'dispatched' | 'at_pickup' | 'in_transit' | 'delayed' | 'needs_driver' | 'delivered';
  driver: string;
  stops: StopSpec[];
  dispatchStatus?: 'assigned' | 'completed' | 'cancelled';
  archived?: boolean;
}): Promise<void> {
  const db = t.db.db;
  const [load] = await db
    .insert(schema.loads)
    .values({
      organizationId: org,
      loadNumber: spec.loadNumber,
      customerId,
      lineHaulCents: 100_000,
      paymentTerms: 'net_30',
      status: spec.status,
      equipmentType: 'flatbed_48',
      commodity: 'Test freight',
      weightLb: 10_000,
      archivedAt: spec.archived ? new Date('2026-09-03T12:00:00Z') : null,
    })
    .returning({ id: schema.loads.id });
  if (!load) throw new Error('load insert failed');
  if (spec.stops.length > 0) {
    await db.insert(schema.loadStops).values(
      spec.stops.map((s, i) => {
        const [city, state] = s.facility ? (CITY_OF[s.facility] ?? ['X', 'XX']) : [s.city ?? null, s.city ? 'CA' : null];
        return {
          organizationId: org,
          loadId: load.id,
          sequence: i + 1,
          kind: s.kind,
          facilityId: s.facility ? (facility[s.facility] ?? null) : null,
          facilityName: s.facility ?? s.city ?? 'Fuel stop',
          city,
          state,
          timezone: 'America/Los_Angeles',
          appointmentDate: s.date,
        };
      }),
    );
  }
  await db
    .insert(schema.dispatches)
    .values({ organizationId: org, loadId: load.id, driverId: driverId[spec.driver] ?? null, status: spec.dispatchStatus ?? 'assigned' });
}

const route = (date: string): StopSpec[] => [
  { kind: 'pickup', facility: 'Cascade Mill', date },
  { kind: 'delivery', facility: 'Duwamish Steel Yard', date },
];

describe('current load (fleet.md §2.2)', () => {
  it('starts from the seed: Priya Raman has none', async () => {
    expect(await currentLoadOf('Priya Raman')).toBe('—');
  });

  it('shows a dispatched load by its first pickup date; the earliest date wins, then the lowest number', async () => {
    await addLoad({ loadNumber: 90010, status: 'dispatched', driver: 'Priya Raman', stops: route('2026-09-10') });
    expect(await currentLoadOf('Priya Raman')).toBe('L-90010 · Sep 10');
    await addLoad({ loadNumber: 90011, status: 'dispatched', driver: 'Priya Raman', stops: route('2026-09-08') });
    expect(await currentLoadOf('Priya Raman')).toBe('L-90011 · Sep 8');
    await addLoad({ loadNumber: 90009, status: 'dispatched', driver: 'Priya Raman', stops: route('2026-09-08') });
    expect(await currentLoadOf('Priya Raman')).toBe('L-90009 · Sep 8');
  });

  it('prefers an in-progress load over any dispatched one, whatever its date', async () => {
    await addLoad({ loadNumber: 90020, status: 'at_pickup', driver: 'Priya Raman', stops: route('2026-09-20') });
    expect(await currentLoadOf('Priya Raman')).toBe('L-90020 · Redding → Seattle');
  });

  it('ignores cancelled dispatches, archived loads, stop-less loads and other statuses', async () => {
    await addLoad({
      loadNumber: 90030,
      status: 'in_transit',
      driver: 'Priya Raman',
      stops: route('2026-09-01'),
      dispatchStatus: 'cancelled',
    });
    await addLoad({ loadNumber: 90031, status: 'delayed', driver: 'Priya Raman', stops: route('2026-09-01'), archived: true });
    await addLoad({ loadNumber: 90032, status: 'in_transit', driver: 'Priya Raman', stops: [] });
    await addLoad({ loadNumber: 90033, status: 'needs_driver', driver: 'Priya Raman', stops: route('2026-09-01') });
    await addLoad({
      loadNumber: 90034,
      status: 'delivered',
      driver: 'Priya Raman',
      stops: route('2026-09-01'),
      dispatchStatus: 'completed',
    });
    expect(await currentLoadOf('Priya Raman')).toBe('L-90020 · Redding → Seattle');
  });

  it('within in-progress loads takes the earliest first pickup', async () => {
    await addLoad({ loadNumber: 90021, status: 'delayed', driver: 'Priya Raman', stops: route('2026-09-15') });
    expect(await currentLoadOf('Priya Raman')).toBe('L-90021 · Redding → Seattle');
  });

  it('reads the first pickup and last delivery by sequence, skipping fuel stops', async () => {
    await addLoad({
      loadNumber: 90050,
      status: 'in_transit',
      driver: 'Tobias Frey',
      stops: [
        { kind: 'fuel', date: '2026-09-01' },
        { kind: 'pickup', facility: 'Reno Grocers DC', date: '2026-09-02' },
        { kind: 'pickup', facility: 'Cascade Mill', date: '2026-09-02' },
        { kind: 'delivery', facility: 'Duwamish Steel Yard', date: '2026-09-03' },
        { kind: 'delivery', facility: 'Wasatch Crossdock', date: '2026-09-04' },
        { kind: 'fuel', date: '2026-09-04' },
      ],
    });
    // Reno Grocers DC's market city is Reno; Wasatch Crossdock's short market is SLC.
    expect(await currentLoadOf('Tobias Frey')).toBe('L-90050 · Reno → SLC');
  });

  it('falls back to the lowest / highest stop without a pickup or delivery, and to the typed city without a facility', async () => {
    await addLoad({
      loadNumber: 90060,
      status: 'in_transit',
      driver: 'Ana Cortez',
      stops: [
        { kind: 'delivery', city: 'Fresno', date: '2026-08-20' },
        { kind: 'delivery', facility: 'Cascade Mill', date: '2026-08-21' },
      ],
    });
    // No pickup: the first stop (Fresno, free text); last delivery Redding. In progress beats Ana's dispatched L-40222.
    expect(await currentLoadOf('Ana Cortez')).toBe('L-90060 · Fresno → Redding');
  });
});

describe('YTD and org-week boundaries (fleet.md §1.1)', () => {
  async function priya(): Promise<DriverListItem> {
    const row = (await roster()).find((d) => d.fullName === 'Priya Raman');
    if (!row) throw new Error('Priya Raman missing');
    return row;
  }

  it('sums mileage from Monday through Sunday of the org week only', async () => {
    const before = (await priya()).weekMiles;
    const id = driverId['Priya Raman'] ?? '';
    await t.db.db.insert(schema.driverMileageEntries).values([
      { organizationId: org, driverId: id, recordedOn: '2026-08-31', miles: 10 },
      { organizationId: org, driverId: id, recordedOn: '2026-09-06', miles: 100 },
      { organizationId: org, driverId: id, recordedOn: '2026-08-30', miles: 1000 },
      { organizationId: org, driverId: id, recordedOn: '2026-09-07', miles: 10000 },
    ]);
    expect((await priya()).weekMiles).toBe(before + 110);
    const res = await admin.get('/api/v1/drivers').expect(200);
    const meta = (res.body as { meta: DriverListMeta }).meta;
    expect(meta.summary.totalWeekMiles).toBe(9120 + 110);
  });

  it('sums line pay of settlements starting Jan 1 through today; not Dec 31, not tomorrow, never deductions', async () => {
    const before = (await priya()).payYtdCents;
    const id = driverId['Priya Raman'] ?? '';
    const settlementFor = async (periodStart: string, periodEnd: string, amounts: [kind: 'line_pay' | 'deduction', cents: number][]) => {
      const [s] = await t.db.db
        .insert(schema.settlements)
        .values({ organizationId: org, driverId: id, periodStart, periodEnd, payBasis: 'per_mile', payRateCents: 62, status: 'paid' })
        .returning({ id: schema.settlements.id });
      if (!s) throw new Error('settlement insert failed');
      await t.db.db
        .insert(schema.settlementItems)
        .values(amounts.map(([kind, amountCents], i) => ({ organizationId: org, settlementId: s.id, position: i + 1, kind, amountCents })));
    };
    await settlementFor('2025-12-31', '2026-01-06', [['line_pay', 100_000]]);
    await settlementFor('2026-01-01', '2026-01-07', [
      ['line_pay', 5_000],
      ['deduction', -2_000],
    ]);
    await settlementFor('2026-09-04', '2026-09-10', [['line_pay', 300_000]]);
    expect((await priya()).payYtdCents).toBe(before + 5_000);
  });
});
