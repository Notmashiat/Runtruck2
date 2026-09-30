import type { CarrierListItem, PageMeta } from '@runtruck/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './helpers.js';

// Carriers (docs/api/carriers.md §4): GET /carriers against the demo seed, plus
// authentication, permissions, tenancy and validation.

let t: TestContext;
let admin: Awaited<ReturnType<TestContext['as']>>;
beforeAll(async () => {
  t = await createTestContext();
  admin = await t.as('admin');
});
afterAll(async () => {
  await t.close();
});

async function get(path: string, agent = admin): Promise<{ data: CarrierListItem[]; meta: PageMeta }> {
  const res = await agent.get(`/api/v1${path}`).expect(200);
  return res.body as { data: CarrierListItem[]; meta: PageMeta };
}

describe('GET /carriers', () => {
  it('returns the five carriers by position, own authority first (carriers.md §2.2)', async () => {
    const { data, meta } = await get('/carriers?limit=500');
    expect(data.map((c) => [c.name, c.mcNumber, c.dotNumber, c.isOwnFleet])).toEqual([
      ['Sunridge Freight', '812044', '2291176', true],
      ['Valley Line Transport', '604117', '1780342', false],
      ['Cascade Reefer Express', '733905', '2014588', false],
      ['High Desert Hauling', '581230', '1655901', false],
      ['Golden State Flatbed', '690452', '1893027', false],
    ]);
    expect(Object.keys(data[0] ?? {}).sort()).toEqual(['dotNumber', 'id', 'isOwnFleet', 'mcNumber', 'name']);
    expect(meta).toEqual({ total: 5, limit: 500, offset: 0 });
  });

  it('matches q over the Runtruck1 Carrier strings', async () => {
    expect((await get('/carriers?q=MC%20733905')).data.map((c) => c.name)).toEqual(['Cascade Reefer Express']);
    expect((await get('/carriers?q=own%20fleet')).data.map((c) => c.name)).toEqual(['Sunridge Freight']);
    expect((await get('/carriers?q=dot%201655901')).data.map((c) => c.name)).toEqual(['High Desert Hauling']);
    // Raw digits match through "MC 604117"; ids never match.
    expect((await get('/carriers?q=604117')).data.map((c) => c.name)).toEqual(['Valley Line Transport']);
    const { data } = await get('/carriers');
    expect((await get(`/carriers?q=${data[0]?.id ?? ''}`)).meta.total).toBe(0);
  });

  it('pages', async () => {
    const page = await get('/carriers?limit=2&offset=3');
    expect(page.data.map((c) => c.name)).toEqual(['High Desert Hauling', 'Golden State Flatbed']);
    expect(page.meta).toEqual({ total: 5, limit: 2, offset: 3 });
  });
});

describe('carriers access control', () => {
  it('requires a session', async () => {
    const res = await request(t.server).get('/api/v1/carriers').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('refuses members without carriers.view', async () => {
    const res = await (await t.as('driver')).get('/api/v1/carriers').expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await (await t.as('dispatcher')).get('/api/v1/carriers').expect(200);
    await (await t.as('accounting')).get('/api/v1/carriers').expect(200);
  });

  it('shows another organization only its own carriers', async () => {
    const other = await t.as('otherAdmin');
    const { data } = await get('/carriers?limit=500', other);
    expect(data.map((c) => [c.name, c.mcNumber, c.isOwnFleet])).toEqual([['Test Carrier Co', '900001', true]]);
    expect((await get('/carriers?q=valley', other)).data).toEqual([]);
  });
});

describe('carriers query validation', () => {
  it.each([
    ['/carriers?limit=0', 'limit'],
    ['/carriers?limit=501', 'limit'],
    ['/carriers?offset=-1', 'offset'],
    [`/carriers?q=${'x'.repeat(201)}`, 'q'],
  ])('%s is a 400 naming %s', async (path, param) => {
    const res = await admin.get(`/api/v1${path}`).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.issues.map((i: { path: string }) => i.path)).toContain(param);
  });
});
