import { type DatabaseHandle, schema } from '@runtruck/database';
import type { LoadDetail, PlannerColorCodeDto } from '@runtruck/types';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATABASE_HANDLE } from '../src/database/database.module.js';
import { REDIS } from '../src/redis/redis.module.js';
import { createTestContext, FIXTURE_USERS, TEST_PASSWORD, type TestContext } from './helpers.js';

// Cross-cutting API hardening (docs/04-api.md §1, §3, §6; docs/19-security.md §2;
// docs/01 C80–C84, C87): refused bodies still get the error envelope, the request id and the
// security headers; the request id is the server's; responses are never cached; only failed
// sign-ins use up the per-IP budget; free text PostgreSQL cannot store is a 400; a haul
// carries only its own kind's fields; concurrent color-code adds are serialized.

type Agent = ReturnType<typeof request.agent>;

let t: TestContext;
let rosa: Agent;
let demo: string;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOGIN = '/api/v1/auth/login';
const UNSTORABLE = 'Remove the unsupported characters (NUL or an incomplete character).';

beforeAll(async () => {
  t = await createTestContext();
  demo = t.orgs.demoOrganizationId;
  rosa = await t.as('admin');
});
afterAll(async () => {
  await t.close();
});

// The response carries one server-minted request id, in the header and the error body alike,
// plus helmet's headers and no-store.
function expectHardenedError(res: request.Response, status: number, message?: string): void {
  expect(res.status).toBe(status);
  const id = res.headers['x-request-id'];
  expect(id).toMatch(UUID);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
  expect(res.body.error.requestId).toBe(id);
  if (message) expect(res.body.error.message).toBe(message);
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['content-security-policy']).toBeDefined();
  expect(res.headers['cache-control']).toBe('no-store');
}

describe('bodies the JSON parser refuses (01 C83)', () => {
  it('answers a body over 1 MB with 413 VALIDATION_ERROR, before any session exists', async () => {
    const res = await request(t.server)
      .post(LOGIN)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'rosa.medina@sunridgefreight.com', password: 'x'.repeat(1_100_000) }));
    expectHardenedError(res, 413, 'The request body is too large.');
  });

  it('answers an unsupported Content-Encoding or charset with 415', async () => {
    const body = JSON.stringify({ email: 'a@b.test', password: 'x' });
    const encoding = await request(t.server).post(LOGIN).set('Content-Type', 'application/json').set('Content-Encoding', 'xyz').send(body);
    expectHardenedError(encoding, 415, 'The request body uses an unsupported encoding or character set.');
    const charset = await request(t.server).post(LOGIN).set('Content-Type', 'application/json; charset=koi8-r').send(body);
    expectHardenedError(charset, 415, 'The request body uses an unsupported encoding or character set.');
  });

  it('answers malformed JSON and a broken gzip stream with 400', async () => {
    expectHardenedError(await request(t.server).post(LOGIN).set('Content-Type', 'application/json').send('{'), 400);
    expectHardenedError(
      await request(t.server).post(LOGIN).set('Content-Type', 'application/json').set('Content-Encoding', 'gzip').send('notgzip'),
      400,
    );
  });

  it('accepts the largest kind of valid New Load (50 stops of CJK text, well over the old 100 kB limit)', async () => {
    const [customer] = await t.db.db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(and(eq(schema.customers.organizationId, demo), eq(schema.customers.name, 'Northgate Foods')));
    const cjk = (n: number) => '東'.repeat(n);
    const stop = (kind: 'pickup' | 'delivery', date: string) => ({
      kind,
      facilityName: cjk(200),
      addressLine1: cjk(200),
      city: cjk(100),
      state: 'CA',
      postalCode: '93725',
      appointmentDate: date,
      referenceNumber: cjk(100),
      siteContact: cjk(200),
    });
    const body = {
      customerId: customer!.id,
      mode: 'ftl',
      equipmentType: 'dry_van_53',
      stops: [...Array.from({ length: 49 }, () => stop('pickup', '2026-09-05')), stop('delivery', '2026-09-06')],
      commodity: cjk(200),
      weightLb: 41_200,
      haul: { hauledBy: 'own_fleet', driverId: null, truckId: null, trailerId: null, driverPayCents: null },
      lineHaulCents: 245_000,
      paymentTerms: 'net_30',
      driverInstructions: cjk(2000),
      internalNotes: cjk(2000),
    };
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(120_000);
    const res = await rosa.post('/api/v1/loads').send(body).expect(201);
    expect((res.body.data as LoadDetail).stops).toHaveLength(50);
  });
});

describe('request ids (01 C81)', () => {
  it('ignores an incoming x-request-id and stores the server id on the audit row', async () => {
    const res = await request(t.server)
      .post(LOGIN)
      .set('x-request-id', 'forged-request-id-0001')
      .send({ email: FIXTURE_USERS.dispatcher, password: TEST_PASSWORD })
      .expect(200);
    const id = res.headers['x-request-id'];
    expect(id).toMatch(UUID);
    expect(id).not.toBe('forged-request-id-0001');
    const [row] = await t.db.db
      .select({ requestId: schema.auditLogs.requestId })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.organizationId, demo), eq(schema.auditLogs.action, 'USER_SIGNED_IN')))
      .orderBy(desc(schema.auditLogs.occurredAt))
      .limit(1);
    expect(row?.requestId).toBe(id);
    const forged = await t.db.db
      .select({ n: count() })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.requestId, 'forged-request-id-0001'));
    expect(forged[0]?.n).toBe(0);
  });
});

describe('caching (01 C82)', () => {
  it('sends no-store on every API response and clears the browser cache on sign-out', async () => {
    const me = await rosa.get('/api/v1/me').expect(200);
    expect(me.headers['cache-control']).toBe('no-store');
    expect(me.headers.pragma).toBe('no-cache');
    const health = await request(t.server).get('/api/v1/health');
    expect(health.headers['cache-control']).toBe('no-store');
    const unauthenticated = await request(t.server).get('/api/v1/settlements').expect(401);
    expect(unauthenticated.headers['cache-control']).toBe('no-store');

    const session = await t.as('accounting');
    const out = await session.post('/api/v1/auth/logout').expect(200);
    expect(out.headers['clear-site-data']).toBe('"cache"');
    expect(out.headers['cache-control']).toBe('no-store');
  });
});

describe('sign-in client IP (01 C80)', () => {
  const redis = () => t.app.get<Redis>(REDIS);

  it('lets successful sign-ins take their hit back, so only failures use up an address', async () => {
    const ip = '203.0.113.50';
    const key = `rl:login:ip:${ip}`;
    await redis().set(key, '99', 'EX', 900);
    const login = (password: string) =>
      request(t.server).post(LOGIN).set('X-Forwarded-For', ip).send({ email: FIXTURE_USERS.admin, password });

    await login(TEST_PASSWORD).expect(200);
    await login(TEST_PASSWORD).expect(200);
    expect(await redis().get(key)).toBe('99');
    await login('wrong-password').expect(401);
    expect(await redis().get(key)).toBe('100');
    const limited = await login(TEST_PASSWORD).expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('takes the client IP from the rightmost X-Forwarded-For entry behind the trusted web hop', async () => {
    const res = await request(t.server)
      .post(LOGIN)
      .set('X-Forwarded-For', '198.51.100.1, 203.0.113.9')
      .send({ email: FIXTURE_USERS.accounting, password: TEST_PASSWORD })
      .expect(200);
    expect(res.headers['set-cookie']).toBeDefined();
    const [session] = await t.db.db
      .select({ ip: schema.sessions.ipAddress })
      .from(schema.sessions)
      .orderBy(desc(schema.sessions.createdAt))
      .limit(1);
    expect(session?.ip).toBe('203.0.113.9');
    expect(await redis().exists('rl:login:ip:198.51.100.1')).toBe(0);
  });
});

describe('database sessions (01 C87)', () => {
  it('run with JIT off and an idle-in-transaction timeout', async () => {
    const handle = t.app.get<DatabaseHandle>(DATABASE_HANDLE);
    const jit = await handle.db.execute<{ jit: string }>(sql`show jit`);
    expect(jit.rows[0]?.jit).toBe('off');
    const idle = await handle.db.execute<{ idle_in_transaction_session_timeout: string }>(sql`show idle_in_transaction_session_timeout`);
    expect(idle.rows[0]?.idle_in_transaction_session_timeout).toBe('1min');
  });
});

describe('free text PostgreSQL cannot store (01 C84)', () => {
  const NUL = '\u0000';

  it('refuses NUL and lone surrogates in New Load, planner and color-code text with 400 at the field', async () => {
    const codes = (await rosa.get('/api/v1/planner/color-codes').expect(200)).body.data as PlannerColorCodeDto[];
    const colorCodeId = codes.find((c) => !c.locked)!.id;
    const event = { title: 'Standup', colorCodeId, date: '2026-09-03' };
    // Built lazily: supertest binds the server per request.
    const cases: [() => request.Test, string][] = [
      [
        () =>
          rosa
            .post('/api/v1/loads')
            .send({ mode: 'ftl', stops: [], haul: { hauledBy: 'own_fleet' }, paymentTerms: 'net_30', commodity: `Frozen${NUL}produce` }),
        'commodity',
      ],
      [
        () =>
          rosa
            .post('/api/v1/loads')
            .send({ mode: 'ftl', stops: [], haul: { hauledBy: 'own_fleet' }, paymentTerms: 'net_30', driverInstructions: `gate${NUL}3` }),
        'driverInstructions',
      ],
      [() => rosa.post('/api/v1/planner/events').send({ ...event, title: `Stand${NUL}up` }), 'title'],
      [() => rosa.post('/api/v1/planner/events').send({ ...event, people: [`A${NUL}B`] }), 'people.0'],
      // Raw JSON escapes, as a client would send a lone surrogate.
      [
        () =>
          rosa
            .post('/api/v1/planner/events')
            .set('Content-Type', 'application/json')
            .send(`{"title":"Stand\\ud800up","colorCodeId":"${colorCodeId}","date":"2026-09-03"}`),
        'title',
      ],
      [() => rosa.post('/api/v1/planner/color-codes').send({ label: `Bad${NUL}label` }), 'label'],
      [
        () => rosa.patch(`/api/v1/planner/color-codes/${colorCodeId}`).set('Content-Type', 'application/json').send('{"label":"x\\udc00"}'),
        'label',
      ],
    ];
    for (const [send, path] of cases) {
      const res = await send();
      expect(res.status).toBe(400);
      expect(res.body.error.issues).toContainEqual({ path, message: UNSTORABLE });
    }
    const q = await rosa.get('/api/v1/planner/events?from=2026-09-01&to=2026-09-30&q=a%00b');
    expect(q.status).toBe(400);
    expect(q.body.error.issues).toContainEqual({ path: 'q', message: UNSTORABLE });
    await rosa.get('/api/v1/loads?q=a%00b').expect(400);
  });

  it('refuses a lone surrogate in New Load text instead of storing U+FFFD', async () => {
    const res = await rosa
      .post('/api/v1/loads')
      .set('Content-Type', 'application/json')
      .send('{"mode":"ftl","stops":[],"haul":{"hauledBy":"own_fleet"},"paymentTerms":"net_30","commodity":"x\\ud800y"}');
    expect(res.status).toBe(400);
    expect(res.body.error.issues).toContainEqual({ path: 'commodity', message: UNSTORABLE });
  });
});

describe('New Load haul kinds (09 §3.1 E3)', () => {
  it("refuses the other kind's fields with a 400 at haul.<field> and creates nothing", async () => {
    const before = await t.db.db.select({ n: count() }).from(schema.loads).where(eq(schema.loads.organizationId, demo));
    const own = await rosa
      .post('/api/v1/loads')
      .send({
        mode: 'ftl',
        stops: [],
        paymentTerms: 'net_30',
        haul: {
          hauledBy: 'own_fleet',
          driverId: null,
          truckId: null,
          trailerId: null,
          driverPayCents: null,
          carrierRateCents: 150_000,
          driverName: 'Bob Smith',
        },
      })
      .expect(400);
    expect(own.body.error.issues).toEqual(
      expect.arrayContaining([
        { path: 'haul.carrierRateCents', message: 'This field is for partner-carrier loads, not own-fleet loads.' },
        { path: 'haul.driverName', message: 'This field is for partner-carrier loads, not own-fleet loads.' },
      ]),
    );
    const partner = await rosa
      .post('/api/v1/loads')
      .send({
        mode: 'ftl',
        stops: [],
        paymentTerms: 'net_30',
        haul: {
          hauledBy: 'partner_carrier',
          carrierId: null,
          carrierRateCents: 50_000,
          driverId: '00000000-0000-4000-8000-000000000003',
          driverPayCents: 61_200,
        },
      })
      .expect(400);
    expect(partner.body.error.issues).toEqual(
      expect.arrayContaining([
        { path: 'haul.driverId', message: 'This field is for own-fleet loads, not partner-carrier loads.' },
        { path: 'haul.driverPayCents', message: 'This field is for own-fleet loads, not partner-carrier loads.' },
      ]),
    );
    const after = await t.db.db.select({ n: count() }).from(schema.loads).where(eq(schema.loads.organizationId, demo));
    expect(after[0]?.n).toBe(before[0]?.n);
  });
});

describe('color-code adds under concurrency (planner.md §3.6)', () => {
  const add = () => rosa.post('/api/v1/planner/color-codes').send({});
  const codesOf = () =>
    t.db.db
      .select({ position: schema.plannerColorCodes.position, tone: schema.plannerColorCodes.tone })
      .from(schema.plannerColorCodes)
      .where(eq(schema.plannerColorCodes.organizationId, demo));

  it('gives concurrent adds distinct positions and the next unused tones', async () => {
    await rosa.post('/api/v1/planner/reset').send({}).expect(200);
    const results = await Promise.all(Array.from({ length: 6 }, add));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201]);
    const added = (await codesOf()).filter((c) => c.position > 6);
    expect(added.map((c) => c.position).sort((a, b) => a - b)).toEqual([7, 8, 9, 10, 11, 12]);
    const tones = added.sort((a, b) => a.position - b.position).map((c) => c.tone);
    expect(tones).toEqual(['pink', 'orange', 'indigo', 'slate', 'slate', 'slate']);
  });

  it('never lets concurrent adds exceed the 100-code limit', async () => {
    const existing = await codesOf();
    const top = Math.max(...existing.map((c) => c.position));
    const fill = 98 - existing.length;
    await t.db.db.insert(schema.plannerColorCodes).values(
      Array.from({ length: fill }, (_, i) => ({
        organizationId: demo,
        key: `fill-${i}`,
        label: `Fill ${i}`,
        tone: 'slate' as const,
        isLocked: false,
        position: top + 1 + i,
      })),
    );
    const results = await Promise.all(Array.from({ length: 4 }, add));
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 409, 409]);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'PLANNER_COLOR_CODE_LIMIT')).toBe(true);
    expect(await codesOf()).toHaveLength(100);
  });
});
