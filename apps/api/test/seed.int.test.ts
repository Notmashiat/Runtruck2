import { schema } from '@runtruck/database';
import { insertPlannerDefaults } from '@runtruck/database/seed';
import { OTHER_ORG_FIXTURE } from '@runtruck/database/testing';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './helpers.js';

// The demo seed (docs/03-database.md §7) and the tenancy fixtures (docs/06-multi-tenancy.md §4):
// row counts per Runtruck1 constant, exact values of representative records, the archived
// history, and a second organization whose rows exist and stay separate.

let t: TestContext;
let demo: string;
let other: string;
beforeAll(async () => {
  t = await createTestContext();
  demo = t.orgs.demoOrganizationId;
  other = t.orgs.otherOrganizationId;
});
afterAll(async () => {
  await t.close();
});

const db = () => t.db.db;

// Rows the demo seed writes per table (§7.0). Platform tables: the seed's own rows.
const DEMO_COUNTS: Record<string, number> = {
  customers: 6,
  customer_contacts: 6,
  carriers: 5,
  facilities: 20,
  employees: 10,
  employee_contracts: 10,
  onboarding_cases: 6,
  onboarding_document_requests: 3,
  drivers: 6,
  driver_mileage_entries: 6,
  trucks: 6,
  trailers: 8,
  loads: 31,
  load_stops: 46,
  dispatches: 7,
  load_activity: 32,
  documents: 35,
  document_versions: 21,
  factoring_companies: 1,
  invoices: 16,
  invoice_items: 16,
  payments: 5,
  invoice_batches: 7,
  invoice_batch_items: 12,
  vendors: 8,
  bills: 8,
  settlements: 5,
  settlement_items: 18,
  work_orders: 8,
  driver_documents: 15,
  compliance_reminders: 4,
  violations: 7,
  claims: 6,
  planner_color_codes: 6,
  planner_events: 42,
  organization_counters: 4,
  audit_logs: 0,
  events: 0,
};

// The 35 tenant-owned domain tables (§3).
const DOMAIN_TABLES = Object.keys(DEMO_COUNTS).filter((table) => !['organization_counters', 'audit_logs', 'events'].includes(table));

async function countRows(table: string, organizationId: string): Promise<number> {
  const result = await db().execute<{ n: string }>(sql`select count(*) as n from ${sql.identifier(table)} where organization_id = ${organizationId}`);
  return Number(result.rows[0]?.n);
}

const BOARD_ORDER = [40218, 40219, 40220, 40221, 40214, 40212, 40210, 40222];
const UNINVOICED = [40209, 40208, 40207, 40206, 40204, 40203, 40205, 40202, 40201, 40200, 40199];
const INVOICE_ONLY = [40198, 40197, 40196, 40191, 40190, 40189, 40187, 40183, 40178, 40176, 40172, 40168];

describe('demo seed', () => {
  it('seeds exactly Runtruck1’s record counts for the demo organization', async () => {
    const counts: Record<string, number> = {};
    for (const table of Object.keys(DEMO_COUNTS)) counts[table] = await countRows(table, demo);
    expect(counts).toEqual(DEMO_COUNTS);
    expect(DOMAIN_TABLES).toHaveLength(35);
  });

  it('creates Sunridge Freight with Rosa Medina linked to her employee record', async () => {
    const [org] = await db().select().from(schema.organizations).where(eq(schema.organizations.id, demo));
    // Authority numbers are digits only, as on the own-fleet carrier row (03 §2.1, §7.1).
    expect(org).toMatchObject({
      name: 'Sunridge Freight',
      shortName: 'Sunridge',
      companyNumber: '30017',
      timezone: 'America/Los_Angeles',
      mcNumber: '812044',
      dotNumber: '2291176',
      plannerDefaults: 'runtruck1_demo',
    });
    const [rosa] = await db()
      .select({ userId: schema.employees.userId, email: schema.users.email })
      .from(schema.employees)
      .innerJoin(schema.users, eq(schema.users.id, schema.employees.userId))
      .where(and(eq(schema.employees.organizationId, demo), eq(schema.employees.lastName, 'Medina')));
    expect(rosa?.email).toBe('rosa.medina@sunridgefreight.com');
  });

  it('continues the human-number counters after the seeded maximum', async () => {
    const rows = await db()
      .select({ key: schema.organizationCounters.key, next: schema.organizationCounters.nextValue })
      .from(schema.organizationCounters)
      .where(eq(schema.organizationCounters.organizationId, demo));
    expect(Object.fromEntries(rows.map((r) => [r.key, r.next]))).toEqual({ load: 40223, invoice: 8846, invoice_batch: 2036, claim: 1113 });
  });

  it('keeps Runtruck1’s 8 board loads in board order and archives exactly the uninvoiced and invoice-only loads', async () => {
    const board = await db()
      .select({ n: schema.loads.loadNumber })
      .from(schema.loads)
      .where(and(eq(schema.loads.organizationId, demo), isNull(schema.loads.archivedAt)))
      .orderBy(desc(schema.loads.createdAt), desc(schema.loads.loadNumber));
    expect(board.map((l) => l.n)).toEqual(BOARD_ORDER);

    const archived = await db()
      .select({ n: schema.loads.loadNumber, archivedAt: schema.loads.archivedAt })
      .from(schema.loads)
      .where(and(eq(schema.loads.organizationId, demo), isNotNull(schema.loads.archivedAt)));
    expect(archived.map((l) => l.n).sort()).toEqual([...UNINVOICED, ...INVOICE_ONLY].sort());
    expect(new Set(archived.map((l) => l.archivedAt?.toISOString()))).toEqual(new Set(['2026-09-03T07:00:00.000Z']));
  });

  it('seeds L-40218 with Runtruck1’s values and its D7 rows', async () => {
    const [load] = await db()
      .select()
      .from(schema.loads)
      .where(and(eq(schema.loads.organizationId, demo), eq(schema.loads.loadNumber, 40218)));
    expect(load).toMatchObject({
      status: 'in_transit',
      tenderRef: 'PO 88-41207',
      mode: null,
      equipmentType: 'reefer_53',
      commodity: 'Frozen produce',
      weightLb: 41_200,
      temperatureF: '-10.0',
      lineHaulCents: 245_000,
      fuelSurchargeCents: 0,
      accessorialCents: 0,
      loadedMiles: 478,
      emptyMiles: 40,
      driverPayCents: 61_200,
      carrierRateCents: null,
      operatingCostCents: 62_400,
      paymentTerms: 'net_30',
      archivedAt: null,
      createdByUserId: null,
    });
    expect(load?.createdAt.toISOString()).toBe('2026-09-03T00:00:00.000Z');
    // Margin = revenue − pay − operating cost = Runtruck1's $1,214.
    expect(load!.lineHaulCents - load!.driverPayCents! - load!.operatingCostCents!).toBe(121_400);

    const [carrier] = await db().select().from(schema.carriers).where(eq(schema.carriers.id, load!.carrierId!));
    expect(carrier).toMatchObject({ name: 'Sunridge Freight', isOwnFleet: true, mcNumber: '812044', dotNumber: '2291176' });

    const stops = await db().select().from(schema.loadStops).where(eq(schema.loadStops.loadId, load!.id)).orderBy(asc(schema.loadStops.sequence));
    expect(
      stops.map((s) => [s.sequence, s.kind, s.status, s.facilityName, s.city, s.state, s.timezone, s.appointmentDate, s.windowOpen, s.windowClose, s.plannedStart, s.plannedEnd]),
    ).toEqual([
      [1, 'pickup', 'completed', 'Northgate Cold Storage', 'Fresno', 'CA', 'America/Los_Angeles', '2026-09-03', '08:00:00', '14:00:00', '10:30:00', '12:30:00'],
      [2, 'fuel', 'pending', 'Planned · 92 gal, DEF top-off', null, null, 'America/Los_Angeles', '2026-09-03', '16:40:00', null, null, null],
      [3, 'delivery', 'pending', 'Reno Grocers DC', 'Sparks', 'NV', 'America/Los_Angeles', '2026-09-04', '06:00:00', '12:00:00', '16:00:00', '18:00:00'],
    ]);
    expect(stops[0]?.addressLine1).toBe('4120 S Golden State Blvd');
    expect(stops[1]).toMatchObject({ facilityId: null, addressLine1: 'Routed automatically on the lane' });
    const [reno] = await db().select().from(schema.facilities).where(eq(schema.facilities.id, stops[2]!.facilityId!));
    expect(reno).toMatchObject({ marketCity: 'Reno', marketState: 'NV' });

    const [dispatch] = await db()
      .select({ driver: schema.employees.lastName, truck: schema.trucks.unitNumber, trailer: schema.trailers.unitNumber, status: schema.dispatches.status })
      .from(schema.dispatches)
      .innerJoin(schema.drivers, eq(schema.drivers.id, schema.dispatches.driverId))
      .innerJoin(schema.employees, eq(schema.employees.id, schema.drivers.employeeId))
      .innerJoin(schema.trucks, eq(schema.trucks.id, schema.dispatches.truckId))
      .innerJoin(schema.trailers, eq(schema.trailers.id, schema.dispatches.trailerId))
      .where(eq(schema.dispatches.loadId, load!.id));
    expect(dispatch).toEqual({ driver: 'Hale', truck: 'T-114', trailer: 'RF-88', status: 'assigned' });

    const docs = await db().select().from(schema.documents).where(eq(schema.documents.loadId, load!.id)).orderBy(asc(schema.documents.position));
    expect(docs.map((d) => [d.documentType, d.status])).toEqual([
      ['rate_confirmation', 'attached'],
      ['bill_of_lading', 'pending'],
      ['proof_of_delivery', 'pending'],
    ]);
    const [version] = await db().select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, docs[0]!.id));
    expect(version).toMatchObject({
      versionNumber: 1,
      fileName: 'rate-confirmation-L-40218.pdf',
      storageKey: `org/${demo}/loads/${load!.id}/documents/${version!.id}`,
      mimeType: 'application/pdf',
      uploadedByUserId: null,
    });
    expect(version?.uploadedAt.toISOString()).toBe('2026-09-03T17:05:00.000Z');

    const activity = await db().select().from(schema.loadActivity).where(eq(schema.loadActivity.loadId, load!.id)).orderBy(asc(schema.loadActivity.sequence));
    expect(activity.map((a) => [a.occurredAt.toISOString(), a.kind, a.message, a.actorUserId])).toEqual([
      ['2026-09-03T14:12:00.000Z', 'driver_accepted', 'Driver accepted the load in the app', null],
      ['2026-09-03T15:41:00.000Z', 'arrived', 'Arrived at Northgate Cold Storage', null],
      ['2026-09-03T17:05:00.000Z', 'document_uploaded', 'Bill of lading uploaded from the cab', null],
      ['2026-09-03T17:06:00.000Z', 'consignee_notified', 'Dispatch notified the consignee', null],
    ]);
  });

  it('stores Runtruck1’s hash-derived planner slots and quirky stop statuses on every board load', async () => {
    const rows = await db()
      .select({ n: schema.loads.loadNumber, kind: schema.loadStops.kind, status: schema.loadStops.status, date: schema.loadStops.appointmentDate, start: schema.loadStops.plannedStart, end: schema.loadStops.plannedEnd })
      .from(schema.loadStops)
      .innerJoin(schema.loads, eq(schema.loads.id, schema.loadStops.loadId))
      .where(and(eq(schema.loadStops.organizationId, demo), isNull(schema.loads.archivedAt), inArray(schema.loadStops.kind, ['pickup', 'delivery'])));
    const slot = (n: number, kind: 'pickup' | 'delivery') => {
      const s = rows.find((r) => r.n === n && r.kind === kind);
      return `${s?.date.slice(5)} ${s?.start?.slice(0, 5)}–${s?.end?.slice(0, 5)} ${s?.status}`;
    };
    // §6.4 table (planned slots) and §7.12 (statuses, C7).
    expect(BOARD_ORDER.map((n) => [n, slot(n, 'pickup'), slot(n, 'delivery')])).toEqual([
      [40218, '09-03 10:30–12:30 completed', '09-04 16:00–18:00 pending'],
      [40219, '09-03 12:00–14:00 arrived', '09-05 08:30–10:30 pending'],
      [40220, '09-02 13:30–15:30 completed', '09-04 13:00–15:00 pending'],
      [40221, '09-04 15:00–17:00 completed', '09-06 17:30–19:30 pending'],
      [40214, '09-01 15:00–17:00 completed', '09-02 10:00–12:00 pending'],
      [40212, '08-31 12:00–14:00 completed', '09-01 13:00–15:00 completed'],
      [40210, '08-29 09:00–11:00 completed', '09-01 16:00–18:00 completed'],
      [40222, '09-05 06:00–08:00 completed', '09-06 10:00–12:00 pending'],
    ]);
  });

  it('gives L-40221 no carrier, dispatch or empty miles, and back-solves deadhead to 7.8 % / 9.2 %', async () => {
    const [l40221] = await db()
      .select()
      .from(schema.loads)
      .where(and(eq(schema.loads.organizationId, demo), eq(schema.loads.loadNumber, 40221)));
    expect(l40221).toMatchObject({ carrierId: null, emptyMiles: null, driverPayCents: null, operatingCostCents: null });
    expect(await db().select().from(schema.dispatches).where(eq(schema.dispatches.loadId, l40221!.id))).toHaveLength(0);

    const week = await db()
      .select({ loaded: schema.loads.loadedMiles, empty: schema.loads.emptyMiles })
      .from(schema.loads)
      .where(and(eq(schema.loads.organizationId, demo), isNull(schema.loads.archivedAt), isNotNull(schema.loads.emptyMiles), inArray(schema.loads.loadNumber, [40218, 40219, 40220, 40214, 40212, 40222])));
    const empty = week.reduce((s, l) => s + l.empty!, 0);
    const loaded = week.reduce((s, l) => s + l.loaded!, 0);
    expect([empty, loaded, (100 * empty / (loaded + empty)).toFixed(1)]).toEqual([258, 3054, '7.8']);
  });

  it('computes exactly Runtruck1’s 11 uninvoiced loads from the seeded rows (§6.0.4)', async () => {
    const result = await db().execute<{ load_number: number; revenue: number; pod: boolean; delivered_on: string }>(sql`
      select l.load_number, l.line_haul_cents + l.fuel_surcharge_cents + l.accessorial_cents as revenue,
             exists (select 1 from documents d where d.organization_id = l.organization_id and d.load_id = l.id
                     and d.document_type = 'proof_of_delivery' and d.status = 'attached') as pod,
             (select s.appointment_date::text from load_stops s where s.organization_id = l.organization_id and s.load_id = l.id
               and s.kind = 'delivery' order by s.sequence desc limit 1) as delivered_on
      from loads l
      where l.organization_id = ${demo} and l.status in ('needs_pod', 'delivered')
        and not exists (select 1 from invoice_items i where i.organization_id = l.organization_id and i.load_id = l.id)
      order by delivered_on desc, l.load_number desc`);
    expect(result.rows.map((r) => r.load_number)).toEqual(UNINVOICED);
    expect(result.rows.reduce((s, r) => s + r.revenue, 0)).toBe(3_490_000);
    expect(result.rows.filter((r) => !r.pod).map((r) => r.load_number)).toEqual([40207, 40204, 40200]);
    expect(result.rows.at(-1)?.delivered_on).toBe('2026-08-27');
  });

  it('seeds the invoices with their terms, due dates, items and batches (C5, C6)', async () => {
    const rows = await db()
      .select({
        n: schema.invoices.invoiceNumber,
        status: schema.invoices.status,
        terms: schema.invoices.paymentTerms,
        issued: schema.invoices.issuedOn,
        due: schema.invoices.dueOn,
        amount: schema.invoiceItems.amountCents,
        load: schema.loads.loadNumber,
      })
      .from(schema.invoices)
      .innerJoin(schema.invoiceItems, eq(schema.invoiceItems.invoiceId, schema.invoices.id))
      .innerJoin(schema.loads, eq(schema.loads.id, schema.invoiceItems.loadId))
      .where(eq(schema.invoices.organizationId, demo));
    const inv = (n: number) => rows.find((r) => r.n === n);
    expect(inv(8836)).toEqual({ n: 8836, status: 'overdue', terms: 'net_30', issued: '2026-07-24', due: '2026-08-23', amount: 412_000, load: 40210 });
    expect(inv(8845)).toEqual({ n: 8845, status: 'draft', terms: 'net_30', issued: null, due: null, amount: 245_000, load: 40218 });
    expect(inv(8829)).toMatchObject({ terms: 'net_45', due: '2026-09-30', load: 40198 });
    expect(rows.filter((r) => r.status === 'overdue').map((r) => r.n).sort()).toEqual([8811, 8815, 8819, 8821, 8836]);

    const paid = await db()
      .select({ n: schema.invoices.invoiceNumber, method: schema.payments.method, at: schema.payments.receivedAt, factor: schema.factoringCompanies.name })
      .from(schema.payments)
      .innerJoin(schema.invoices, eq(schema.invoices.id, schema.payments.invoiceId))
      .leftJoin(schema.factoringCompanies, eq(schema.factoringCompanies.id, schema.payments.factoringCompanyId))
      .where(eq(schema.payments.organizationId, demo))
      .orderBy(desc(schema.payments.receivedAt));
    expect(paid.map((p) => [p.n, p.method, p.factor])).toEqual([
      [8823, 'check', null],
      [8824, 'ach', null],
      [8838, 'factoring', 'TriPoint Capital'],
      [8839, 'factoring', 'TriPoint Capital'],
      [8830, 'ach', null],
    ]);

    const batches = await db().execute<{ batch_number: number; invoices: string; total: string | null }>(sql`
      select b.batch_number, count(bi.id) as invoices, sum(ii.amount_cents) as total
      from invoice_batches b
      left join invoice_batch_items bi on bi.organization_id = b.organization_id and bi.batch_id = b.id
      left join invoice_items ii on ii.organization_id = bi.organization_id and ii.invoice_id = bi.invoice_id
      where b.organization_id = ${demo}
      group by b.batch_number order by b.batch_number desc`);
    expect(batches.rows.map((b) => [b.batch_number, Number(b.invoices), Number(b.total ?? 0)])).toEqual([
      [2035, 2, 443_000],
      [2034, 3, 855_000],
      [2033, 2, 494_000],
      [2032, 2, 482_000],
      [2031, 2, 559_000],
      [2030, 0, 0],
      [2029, 1, 245_000],
    ]);
  });

  it('splits the settlements into items that total Runtruck1’s figures', async () => {
    const result = await db().execute<{ last_name: string; loads: string; miles: string; gross: string; ded: string; status: string; hold: string | null }>(sql`
      select e.last_name, s.status, s.hold_reason as hold,
             count(*) filter (where i.kind = 'line_pay') as loads,
             coalesce(sum(i.miles), 0) as miles,
             coalesce(sum(i.amount_cents) filter (where i.kind = 'line_pay'), 0) as gross,
             coalesce(sum(i.amount_cents) filter (where i.kind = 'deduction'), 0) as ded
      from settlements s
      join drivers d on d.organization_id = s.organization_id and d.id = s.driver_id
      join employees e on e.organization_id = d.organization_id and e.id = d.employee_id
      join settlement_items i on i.organization_id = s.organization_id and i.settlement_id = s.id
      where s.organization_id = ${demo}
      group by e.last_name, s.status, s.hold_reason, d.position order by d.position`);
    expect(result.rows.map((r) => [r.last_name, Number(r.loads), Number(r.miles), Number(r.gross), Number(r.ded), r.status, r.hold])).toEqual([
      ['Hale', 4, 2140, 132_600, -14_200, 'ready', null],
      ['Whitfield', 3, 1980, 118_800, -9_600, 'ready', null],
      ['Nakamura', 3, 1760, 145_500, -21_000, 'on_hold', 'fuel'],
      ['Raman', 2, 1420, 82_400, -6_400, 'ready', null],
      ['Cortez', 2, 1180, 68_400, 0, 'paid', null],
    ]);
  });

  it('seeds every attached document with one placeholder version under its tenant storage key', async () => {
    const versions = await db()
      .select({
        id: schema.documentVersions.id,
        key: schema.documentVersions.storageKey,
        load: schema.documents.loadId,
        size: schema.documentVersions.sizeBytes,
        sha: schema.documentVersions.checksumSha256,
      })
      .from(schema.documentVersions)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
      .where(eq(schema.documentVersions.organizationId, demo));
    expect(versions).toHaveLength(21);
    // 03 §5.7.2: built from ids known before the upload transaction (13 §4.4).
    for (const v of versions) expect(v.key).toBe(`org/${demo}/loads/${v.load}/documents/${v.id}`);
    expect(new Set(versions.map((v) => `${v.size}:${v.sha}`)).size).toBe(1);
    expect(versions[0]?.sha).toMatch(/^[0-9a-f]{64}$/);
    const attached = await countRowsWhere(sql`select count(*) as n from documents where organization_id = ${demo} and status = 'attached'`);
    expect(attached).toBe(21);
  });

  it('seeds the shared calendar defaults in Runtruck1 order', async () => {
    const codes = await db()
      .select({ key: schema.plannerColorCodes.key, label: schema.plannerColorCodes.label, tone: schema.plannerColorCodes.tone, locked: schema.plannerColorCodes.isLocked })
      .from(schema.plannerColorCodes)
      .where(eq(schema.plannerColorCodes.organizationId, demo))
      .orderBy(desc(schema.plannerColorCodes.isLocked), asc(schema.plannerColorCodes.position));
    expect(codes.map((c) => c.label)).toEqual(['Loaded (pickup)', 'Empty (delivery)', 'Maintenance', 'Driver schedule', 'Meetings', 'Billing & admin']);

    const events = await db()
      .select({ title: schema.plannerEvents.title, date: schema.plannerEvents.startDate, people: schema.plannerEvents.people, by: schema.plannerEvents.createdByUserId })
      .from(schema.plannerEvents)
      .where(eq(schema.plannerEvents.organizationId, demo))
      .orderBy(asc(schema.plannerEvents.createdAt), asc(schema.plannerEvents.id));
    const standups = events.filter((e) => e.title === 'Dispatch standup');
    expect(standups).toHaveLength(27);
    expect(standups.filter((e) => e.date.startsWith('2026-09'))).toHaveLength(21);
    expect(standups.some((e) => e.date === '2026-09-07')).toBe(false);
    expect(events.slice(27).map((e) => e.title)).toEqual([
      'Tobias Frey — home time',
      'T-118 in shop — turbo',
      'Payroll review — week of Sep 1',
      'Invoice batch B-2034 review',
      'FB-12 DOT annual inspection',
      'Road test — Sofia Nguyen',
      'T-114 PM service A',
      'Labor Day — office closed',
      'Orientation — Jamal Reed',
      'Safety meeting — HOS refresher',
      'Northgate Foods quarterly review',
      'IFTA Q3 prep',
      'Sierra Ag collections call',
      'Marcus Hale — Clearinghouse query due',
      'Ana Cortez — MVR & annual review due',
    ]);
    expect(events.find((e) => e.title === 'T-118 in shop — turbo')?.people).toEqual([]);
    expect(events.every((e) => e.by === null)).toBe(true);
  });

  it('orders the office events of a week as Runtruck1’s `all`: standups first, then ev-1 … ev-7 (planner.md §2.5, §3.1)', async () => {
    const week = await db().execute<{ title: string; date: string }>(sql`
      select title, start_date::text as date from planner_events
      where organization_id = ${demo} and start_date <= '2026-09-06' and coalesce(end_date, start_date) >= '2026-08-31'
        and start_date >= date '2026-08-31' - 366
      order by created_at, start_date, start_time nulls first, id`);
    expect(week.rows.map((e) => (e.title === 'Dispatch standup' ? `standup ${e.date}` : e.title))).toEqual([
      'standup 2026-08-31',
      'standup 2026-09-01',
      'standup 2026-09-02',
      'standup 2026-09-03',
      'standup 2026-09-04',
      'Tobias Frey — home time',
      'T-118 in shop — turbo',
      'Payroll review — week of Sep 1',
      'Invoice batch B-2034 review',
      'FB-12 DOT annual inspection',
      'Road test — Sofia Nguyen',
      'T-114 PM service A',
    ]);
    const createdAt = await db().execute<{ first: string; last: string; n: string }>(sql`
      select min(created_at) as first, max(created_at) as last, count(distinct created_at) as n from planner_events where organization_id = ${demo}`);
    const row = createdAt.rows[0]!;
    expect([new Date(row.first).toISOString(), new Date(row.last).toISOString(), Number(row.n)]).toEqual(['2026-09-02T23:59:18.000Z', '2026-09-02T23:59:59.000Z', 42]);
  });

  it('Reset calendar’s shared insert restores the demo organization’s 42 events and 6 codes with the seed’s instants', async () => {
    const result = await resetInRolledBackTransaction(demo);
    expect(result).toEqual({ eventCount: 42, colorCodeCount: 6, codes: 6, events: 42, sunridgeTexts: 1, firstCreated: '2026-09-02T23:59:18.000Z' });
  });

  it('refuses a load total or a planner span that the API bounds (CHECK loads_total_ck, planner_events_span_ck)', async () => {
    const [load] = await db().select().from(schema.loads).where(and(eq(schema.loads.organizationId, demo), eq(schema.loads.loadNumber, 40218)));
    await expect(db().update(schema.loads).set({ lineHaulCents: 2_147_483_647, fuelSurchargeCents: 1 }).where(eq(schema.loads.id, load!.id))).rejects.toThrow();
    const [code] = await db()
      .select({ id: schema.plannerColorCodes.id })
      .from(schema.plannerColorCodes)
      .where(and(eq(schema.plannerColorCodes.organizationId, demo), eq(schema.plannerColorCodes.key, 'driver')));
    await expect(
      db().insert(schema.plannerEvents).values({ organizationId: demo, title: 'Too long', colorCodeId: code!.id, startDate: '2026-01-01', endDate: '2027-01-03' }),
    ).rejects.toThrow();
    // Sums over the three money columns stay in range for every stored row.
    const total = await db().execute<{ max: string }>(sql`
      select max(line_haul_cents::bigint + fuel_surcharge_cents + accessorial_cents) as max from loads where organization_id = ${demo}`);
    expect(Number(total.rows[0]?.max)).toBeLessThanOrEqual(2_147_483_647);
  });

  it('seeds the fleet, HR and safety lists with Runtruck1’s values', async () => {
    const drivers = await db().execute<{ name: string; duty: string; hos: number | null; miles: number; unit: string | null; cdl: string | null }>(sql`
      select e.first_name || ' ' || e.last_name as name, d.duty_status as duty, d.hos_remaining_minutes as hos, m.miles,
             (select t.unit_number from trucks t where t.organization_id = d.organization_id and t.assigned_driver_id = d.id) as unit,
             (select dd.expires_on::text from driver_documents dd where dd.organization_id = d.organization_id and dd.driver_id = d.id and dd.document_type = 'cdl') as cdl
      from drivers d
      join employees e on e.organization_id = d.organization_id and e.id = d.employee_id
      join driver_mileage_entries m on m.organization_id = d.organization_id and m.driver_id = d.id
      where d.organization_id = ${demo} order by d.position`);
    expect(drivers.rows).toEqual([
      { name: 'Marcus Hale', duty: 'on_duty', hos: 380, miles: 2140, unit: 'T-114', cdl: '2028-04-30' },
      { name: 'Dara Whitfield', duty: 'on_duty', hos: 545, miles: 1980, unit: 'T-107', cdl: '2027-11-30' },
      { name: 'Ellis Nakamura', duty: 'on_duty', hos: 105, miles: 1760, unit: 'T-121', cdl: '2027-02-28' },
      { name: 'Priya Raman', duty: 'available', hos: 660, miles: 1420, unit: 'T-103', cdl: '2026-07-31' },
      { name: 'Ana Cortez', duty: 'available', hos: 660, miles: 1180, unit: 'T-109', cdl: '2029-09-30' },
      { name: 'Tobias Frey', duty: 'home_time', hos: null, miles: 640, unit: 'T-118', cdl: '2028-01-31' },
    ]);

    const trailers = await db().execute<{ unit_number: string; location: string }>(sql`
      select t.unit_number, case t.location_kind when 'yard' then 'Yard · ' || f.city when 'en_route' then 'En route · ' || t.location_route
             else t.location_city || ', ' || t.location_state end as location
      from trailers t left join facilities f on f.organization_id = t.organization_id and f.id = t.location_facility_id
      where t.organization_id = ${demo} order by t.position`);
    expect(trailers.rows.map((r) => `${r.unit_number} ${r.location}`)).toEqual([
      'RF-27 Bakersfield, CA',
      'RF-09 Yard · Modesto',
      'RF-88 En route · I-80',
      'DV-51 Stockton, CA',
      'DV-88 Yard · Modesto',
      'DV-14 Las Vegas, NV',
      'FB-04 Redding, CA',
      'FB-12 Yard · Modesto',
    ]);

    const requests = await db().execute<{ candidate_name: string; label: string }>(sql`
      select c.candidate_name, r.label from onboarding_document_requests r
      join onboarding_cases c on c.organization_id = r.organization_id and c.id = r.onboarding_case_id
      where r.organization_id = ${demo} and r.status = 'pending' order by c.position, r.position`);
    expect(requests.rows.map((r) => `${r.candidate_name}: ${r.label}`)).toEqual(['Derek Holt: MVR consent', 'Derek Holt: insurance certificate', 'Kevin Brandt: medical card']);

    const contracts = await db()
      .select({ basis: schema.employeeContracts.payBasis, rate: schema.employeeContracts.payRateCents, bp: schema.employeeContracts.payPercentBp, status: schema.employeeContracts.status })
      .from(schema.employeeContracts)
      .where(eq(schema.employeeContracts.organizationId, demo))
      .orderBy(asc(schema.employeeContracts.position));
    expect(contracts.map((c) => c.rate ?? `${c.bp}bp`)).toEqual([62, 60, '2500bp', 58, 58, 118, 6_800_000, 3450, 5_200_000, 56]);
    expect(contracts.filter((c) => c.status === 'active')).toHaveLength(6);

    const claims = await db().execute<{ claim_number: number; claimant: string }>(sql`
      select c.claim_number, coalesce(cu.name, f.name, 'Third party · ' || c.claimant_name) as claimant
      from claims c
      left join customers cu on cu.organization_id = c.organization_id and cu.id = c.claimant_customer_id
      left join facilities f on f.organization_id = c.organization_id and f.id = c.claimant_facility_id
      where c.organization_id = ${demo} order by c.claim_number desc`);
    expect(claims.rows.map((c) => `${c.claim_number} ${c.claimant}`)).toEqual([
      '1112 Cascade Building Supply',
      '1111 Northgate Foods',
      '1110 Wasatch Crossdock',
      '1109 Sierra Ag Partners',
      '1108 Third party · R. Delgado',
      '1107 Northgate Foods',
    ]);
  });
});

async function countRowsWhere(query: SQL): Promise<number> {
  const result = await db().execute<{ n: string }>(query);
  return Number(result.rows[0]?.n);
}

class Rollback extends Error {}

interface ResetOutcome {
  eventCount: number;
  colorCodeCount: number;
  codes: number;
  events: number;
  sunridgeTexts: number;
  firstCreated: string | null;
}

// Runs the Reset calendar steps (planner.md §3.11: delete events and codes, insert the
// organization's defaults) inside a transaction that is rolled back, and reports what the
// organization would then hold.
async function resetInRolledBackTransaction(organizationId: string): Promise<ResetOutcome | undefined> {
  let outcome: ResetOutcome | undefined;
  await db()
    .transaction(async (tx) => {
      await tx.delete(schema.plannerEvents).where(eq(schema.plannerEvents.organizationId, organizationId));
      await tx.delete(schema.plannerColorCodes).where(eq(schema.plannerColorCodes.organizationId, organizationId));
      const { eventCount, colorCodeCount } = await insertPlannerDefaults(tx, organizationId);
      const counts = await tx.execute<{ codes: string; events: string; sunridge: string; first: string | null }>(sql`
        select (select count(*) from planner_color_codes where organization_id = ${organizationId}) as codes,
               (select count(*) from planner_events where organization_id = ${organizationId}) as events,
               (select count(*) from planner_events where organization_id = ${organizationId}
                  and (title ilike '%Northgate%' or notes ilike '%INV-8836%' or 'Rosa Medina' = any(people))) as sunridge,
               (select min(created_at) from planner_events where organization_id = ${organizationId}) as first`);
      const row = counts.rows[0]!;
      outcome = {
        eventCount,
        colorCodeCount,
        codes: Number(row.codes),
        events: Number(row.events),
        sunridgeTexts: Number(row.sunridge) > 0 ? 1 : 0,
        firstCreated: row.first === null ? null : new Date(row.first).toISOString(),
      };
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
  return outcome;
}

describe('tenancy fixtures', () => {
  it('gives Test Carrier Co at least one row in every tenant-owned domain table', async () => {
    const empty: string[] = [];
    for (const table of DOMAIN_TABLES) if ((await countRows(table, other)) === 0) empty.push(table);
    expect(empty).toEqual([]);
    expect(await countRows('organization_counters', other)).toBe(4);
  });

  it('gives Test Carrier Co the standard calendar, and its Reset writes no Sunridge rows (D8, 03 §5.12.2)', async () => {
    const [org] = await db().select({ set: schema.organizations.plannerDefaults }).from(schema.organizations).where(eq(schema.organizations.id, other));
    expect(org?.set).toBe('standard');
    const titles = await db().select({ title: schema.plannerEvents.title }).from(schema.plannerEvents).where(eq(schema.plannerEvents.organizationId, other));
    expect(titles.map((e) => e.title)).toEqual([OTHER_ORG_FIXTURE.plannerEventTitle]);
    expect(await countRows('planner_color_codes', other)).toBe(6);

    expect(await resetInRolledBackTransaction(other)).toEqual({ eventCount: 0, colorCodeCount: 6, codes: 6, events: 0, sunridgeTexts: 0, firstCreated: null });
    // The rollback left both organizations as they were.
    expect(await countRows('planner_events', other)).toBe(1);
    expect(await countRows('planner_events', demo)).toBe(42);
  });

  it('keeps the two organizations’ rows apart', async () => {
    const [org] = await db().select().from(schema.organizations).where(eq(schema.organizations.id, other));
    expect(org).toMatchObject({ name: 'Test Carrier Co', timezone: OTHER_ORG_FIXTURE.timezone });

    const otherLoads = await db().select({ n: schema.loads.loadNumber }).from(schema.loads).where(eq(schema.loads.organizationId, other));
    expect(otherLoads.map((l) => l.n).sort()).toEqual([OTHER_ORG_FIXTURE.archivedLoadNumber, OTHER_ORG_FIXTURE.loadNumber]);
    const demoCustomerNames = await db().select({ name: schema.customers.name }).from(schema.customers).where(eq(schema.customers.organizationId, demo));
    expect(demoCustomerNames.map((c) => c.name)).not.toContain(OTHER_ORG_FIXTURE.customerName);

    // Every reference of the other organization's rows resolves inside it (composite tenant keys, 03 §1.3).
    const crossRefs = await countRowsWhere(sql`
      select count(*) as n from loads l join customers c on c.id = l.customer_id
      where l.organization_id = ${other} and c.organization_id <> l.organization_id`);
    expect(crossRefs).toBe(0);

    // The database itself refuses a row that points at another tenant's customer.
    const [demoCustomer] = await db().select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.organizationId, demo)).limit(1);
    await expect(
      db()
        .insert(schema.loads)
        .values({ organizationId: other, loadNumber: 59999, customerId: demoCustomer!.id, lineHaulCents: 1, paymentTerms: 'net_30', status: 'delivered', archivedAt: new Date() }),
    ).rejects.toThrow();
    expect(await countRows('loads', other)).toBe(2);
  });
});
