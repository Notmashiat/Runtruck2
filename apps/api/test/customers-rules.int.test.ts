import { schema } from '@runtruck/database';
import type { CustomerListItem, CustomerListMeta } from '@runtruck/types';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './helpers.js';

// The CRM aggregates of GET /customers against records written for the purpose
// (docs/api/customers.md §1.3, §5): the load-date fallback to the first issued invoice,
// lateness at the window-close boundary in the stop's time zone, the open-AR rule, and
// sums beyond the integer range. This file writes to its own freshly seeded database.

let t: TestContext;
let admin: Awaited<ReturnType<TestContext['as']>>;
let org: string;

beforeAll(async () => {
  t = await createTestContext();
  admin = await t.as('admin');
  org = t.orgs.demoOrganizationId;
});
afterAll(async () => {
  await t.close();
});

async function crm(): Promise<{ data: CustomerListItem[]; meta: CustomerListMeta }> {
  const res = await admin.get('/api/v1/customers?limit=500').expect(200);
  return res.body as { data: CustomerListItem[]; meta: CustomerListMeta };
}

interface StopSpec {
  kind: 'pickup' | 'delivery';
  date: string;
  timezone?: string;
  windowClose?: string;
  arrivedAt?: string;
}

async function addLoad(
  customerId: string,
  loadNumber: number,
  cents: { lineHaul: number; fuel?: number; accessorial?: number },
  stops: StopSpec[],
): Promise<string> {
  const db = t.db.db;
  const [load] = await db
    .insert(schema.loads)
    .values({
      organizationId: org,
      loadNumber,
      customerId,
      lineHaulCents: cents.lineHaul,
      fuelSurchargeCents: cents.fuel ?? 0,
      accessorialCents: cents.accessorial ?? 0,
      paymentTerms: 'net_30',
      status: 'delivered',
      archivedAt: new Date('2026-09-01T00:00:00Z'),
    })
    .returning({ id: schema.loads.id });
  if (!load) throw new Error('load insert failed');
  if (stops.length > 0) {
    await db.insert(schema.loadStops).values(
      stops.map((s, i) => ({
        organizationId: org,
        loadId: load.id,
        sequence: i + 1,
        kind: s.kind,
        status: s.arrivedAt ? ('completed' as const) : ('pending' as const),
        facilityName: 'Test dock',
        city: 'Denver',
        state: 'CO',
        timezone: s.timezone ?? 'America/Denver',
        appointmentDate: s.date,
        windowClose: s.windowClose ?? null,
        arrivedAt: s.arrivedAt ? new Date(s.arrivedAt) : null,
      })),
    );
  }
  return load.id;
}

async function addInvoice(
  customerId: string,
  invoiceNumber: number,
  status: 'draft' | 'sent' | 'overdue' | 'paid',
  issuedOn: string | null,
  items: [loadId: string, cents: number][],
  paidCents = 0,
): Promise<void> {
  const db = t.db.db;
  const [invoice] = await db
    .insert(schema.invoices)
    .values({ organizationId: org, invoiceNumber, customerId, status, paymentTerms: 'net_30', issuedOn, dueOn: issuedOn })
    .returning({ id: schema.invoices.id });
  if (!invoice) throw new Error('invoice insert failed');
  await db.insert(schema.invoiceItems).values(
    items.map(([loadId, amountCents], i) => ({
      organizationId: org,
      invoiceId: invoice.id,
      position: i + 1,
      loadId,
      description: 'Line haul',
      amountCents,
    })),
  );
  if (paidCents > 0) {
    await db.insert(schema.payments).values({
      organizationId: org,
      invoiceId: invoice.id,
      receivedAt: new Date('2026-08-01T16:00:00Z'),
      method: 'ach',
      amountCents: paidCents,
    });
  }
}

describe('CRM aggregates from records (customers.md §1.3)', () => {
  it('counts load dates, lateness in the stop time zone and open AR exactly', async () => {
    const [customer] = await t.db.db
      .insert(schema.customers)
      .values({ organizationId: org, name: 'Boundary Test Co', standing: 'growing', paymentTerms: 'net_30', position: 7 })
      .returning({ id: schema.customers.id });
    const c = customer?.id ?? '';

    // Deliveries in Denver (MDT, UTC−6) with a 15:00 window close: on the minute is on time.
    const delivered = (arrivedAt: string, windowClose?: string): StopSpec[] => [
      { kind: 'pickup', date: '2026-06-09' },
      { kind: 'delivery', date: '2026-06-10', ...(windowClose ? { windowClose } : {}), arrivedAt },
    ];
    await addLoad(c, 91001, { lineHaul: 100_000 }, delivered('2026-06-10T21:00:00Z', '15:00')); // 15:00 local: on time
    await addLoad(c, 91002, { lineHaul: 100_000 }, delivered('2026-06-10T21:01:00Z', '15:00')); // 15:01 local: late
    await addLoad(c, 91003, { lineHaul: 100_000 }, delivered('2026-06-11T05:59:00Z')); // 23:59 local, open window: on time
    await addLoad(c, 91004, { lineHaul: 100_000 }, delivered('2026-06-11T06:00:00Z')); // 00:00 the next day: late

    // Stop-less loads count by their first invoice's issue date (01 C8).
    const x = await addLoad(c, 91010, { lineHaul: 10_000, fuel: 500, accessorial: 250 }, []); // invoiced Feb 1: YTD
    const y = await addLoad(c, 91011, { lineHaul: 20_000 }, []); // invoiced last December: not YTD
    const z = await addLoad(c, 91012, { lineHaul: 30_000 }, []); // first invoice last December, second in January: not YTD
    // A load whose first pickup is last year is not YTD, although a later stop and its invoice are.
    const w = await addLoad(c, 91013, { lineHaul: 40_000 }, [
      { kind: 'pickup', date: '2025-12-30' },
      { kind: 'delivery', date: '2026-01-02' },
    ]);
    // Picks up after today: not YTD.
    await addLoad(c, 91014, { lineHaul: 50_000 }, [
      { kind: 'pickup', date: '2026-09-04' },
      { kind: 'delivery', date: '2026-09-05' },
    ]);

    await addInvoice(
      c,
      99001,
      'sent',
      '2026-02-01',
      [
        [x, 10_000],
        [w, 5_000],
      ],
      3_000,
    ); // outstanding 12,000
    await addInvoice(c, 99002, 'overdue', '2025-12-15', [[y, 7_000]]); // outstanding 7,000
    await addInvoice(c, 99003, 'draft', null, [[y, 50_000]]); // drafts are not AR
    await addInvoice(c, 99004, 'paid', '2025-12-20', [[z, 4_000]], 4_000); // paid: not AR
    await addInvoice(c, 99005, 'sent', '2026-01-05', [[z, 6_000]]); // outstanding 6,000

    const { data, meta } = await crm();
    const row = data.find((r) => r.name === 'Boundary Test Co');
    expect(row).toEqual({
      id: c,
      name: 'Boundary Test Co',
      standing: 'growing',
      paymentTerms: 'net_30',
      primaryContact: null,
      // 91001–91004 and 91010.
      loadsYtd: 5,
      revenueYtdCents: 4 * 100_000 + 10_750,
      // 91002 and 91004 are late: 3 of 5.
      onTimePercent: 60,
      arBalanceCents: 12_000 + 7_000 + 6_000,
    });
    expect(data.at(-1)?.name).toBe('Boundary Test Co');
    expect(meta.summary).toMatchObject({
      accountCount: 7,
      revenueYtdCents: 8_360_000 + 410_750,
      // (28 + 3) on time of (29 + 5).
      onTimePercent: Math.round((100 * 31) / 34),
      openArCents: 2_618_000 + 25_000,
    });
  });

  it('counts a delayed load as late whatever its arrival', async () => {
    const db = t.db.db;
    const [l40220] = await db
      .select({ id: schema.loads.id })
      .from(schema.loads)
      .where(and(eq(schema.loads.organizationId, org), eq(schema.loads.loadNumber, 40220)));
    // Arrived early at Boise Builders Depot; the load is still `delayed`.
    await db
      .update(schema.loadStops)
      .set({ status: 'arrived', arrivedAt: new Date('2026-09-04T14:00:00Z') })
      .where(
        and(eq(schema.loadStops.organizationId, org), eq(schema.loadStops.loadId, l40220?.id ?? ''), eq(schema.loadStops.kind, 'delivery')),
      );
    expect((await crm()).data.find((r) => r.name === 'Cascade Building Supply')).toMatchObject({ loadsYtd: 6, onTimePercent: 83 });
  });

  it('sums revenue beyond the integer range without overflowing (03 §6.0.3)', async () => {
    const [northgate] = await t.db.db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(and(eq(schema.customers.organizationId, org), eq(schema.customers.name, 'Northgate Foods')));
    // The largest total to customer the schema accepts (loads_total_ck), picked up earlier this year.
    await addLoad(northgate?.id ?? '', 91100, { lineHaul: 2_147_483_647 }, [
      { kind: 'pickup', date: '2026-03-02', timezone: 'America/Los_Angeles' },
      { kind: 'delivery', date: '2026-03-03', timezone: 'America/Los_Angeles' },
    ]);
    const { data, meta } = await crm();
    expect(data.find((r) => r.name === 'Northgate Foods')).toMatchObject({ loadsYtd: 6, revenueYtdCents: 1_131_000 + 2_147_483_647 });
    expect(meta.summary.revenueYtdCents).toBe(8_360_000 + 410_750 + 2_147_483_647);
  });
});
