import type { FacilityListItem, PageMeta } from '@runtruck/types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './helpers.js';

// Facilities (docs/api/facilities.md §4): GET /facilities against the demo seed, plus
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

async function get(path: string, agent = admin): Promise<{ data: FacilityListItem[]; meta: PageMeta }> {
  const res = await agent.get(`/api/v1${path}`).expect(200);
  return res.body as { data: FacilityListItem[]; meta: PageMeta };
}

describe('GET /facilities', () => {
  it('returns the 20 seeded facilities by name (facilities.md §2.2)', async () => {
    const { data, meta } = await get('/facilities?limit=500');
    expect(data.map((f) => f.name)).toEqual([
      'Bayline DC 4',
      'Bayline LA Annex',
      'Boise Builders Depot',
      'Cascade Mill',
      'Cascade Yard 2',
      'Duwamish Steel Yard',
      'Front Range Foods',
      'Harbor Point DC',
      'Northgate Cold Storage',
      'Northgate Creamery',
      'Port of Oakland, Berth 22',
      'Reno Grocers DC',
      'Sierra Ag Huller 3',
      'Sunridge shop',
      'Sunridge yard',
      'Sunset Beverage DC',
      'Thermo King',
      'Valley Foods DC',
      'Valley Truck Center',
      'Wasatch Crossdock',
    ]);
    expect(meta).toEqual({ total: 20, limit: 500, offset: 0 });
    expect(data.find((f) => f.name === 'Wasatch Crossdock')).toMatchObject({
      kind: 'crossdock',
      addressLine1: '1740 S 4130 W',
      city: 'Salt Lake City',
      state: 'UT',
      timezone: 'America/Denver',
      marketCity: null,
      marketShort: 'SLC',
    });
    expect(data.find((f) => f.name === 'Reno Grocers DC')).toMatchObject({
      city: 'Sparks',
      state: 'NV',
      marketCity: 'Reno',
      marketState: 'NV',
      marketShort: null,
    });
    expect(data.find((f) => f.name === 'Sunridge yard')).toMatchObject({
      kind: 'yard',
      addressLine1: null,
      city: 'Modesto',
      postalCode: null,
    });
  });

  it('matches q over name, address, city, state and postal code', async () => {
    expect((await get('/facilities?q=modesto')).data.map((f) => f.name)).toEqual(['Sierra Ag Huller 3', 'Sunridge shop', 'Sunridge yard']);
    expect((await get('/facilities?q=MARITIME')).data.map((f) => f.name)).toEqual(['Port of Oakland, Berth 22']);
    expect((await get('/facilities?q=%20wa%20')).data.map((f) => f.name)).toEqual(['Duwamish Steel Yard', 'Wasatch Crossdock']);
    // Market columns, kind and timezone are not searched.
    expect((await get('/facilities?q=SLC')).meta.total).toBe(0);
    expect((await get('/facilities?q=crossdock')).data.map((f) => f.name)).toEqual(['Wasatch Crossdock']);
    expect((await get('/facilities?q=america')).meta.total).toBe(0);
  });

  it('pages', async () => {
    const page = await get('/facilities?limit=3&offset=18');
    expect(page.data.map((f) => f.name)).toEqual(['Valley Truck Center', 'Wasatch Crossdock']);
    expect(page.meta).toEqual({ total: 20, limit: 3, offset: 18 });
  });
});

describe('facilities access control', () => {
  it('requires a session', async () => {
    const res = await request(t.server).get('/api/v1/facilities').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('refuses members without locations.view', async () => {
    for (const user of ['driver', 'accounting'] as const) {
      const res = await (await t.as(user)).get('/api/v1/facilities').expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    await (await t.as('dispatcher')).get('/api/v1/facilities').expect(200);
  });

  it('shows another organization only its own facilities', async () => {
    const other = await t.as('otherAdmin');
    const { data } = await get('/facilities?limit=500', other);
    expect(data.map((f) => f.name)).toEqual(['Gulf Receiving', 'Prairie Goods DC', 'Test Carrier shop']);
    expect((await get('/facilities?q=modesto', other)).data).toEqual([]);
  });
});

describe('facilities query validation', () => {
  it.each([
    ['/facilities?limit=0', 'limit'],
    ['/facilities?limit=501', 'limit'],
    ['/facilities?offset=-1', 'offset'],
    [`/facilities?q=${'x'.repeat(201)}`, 'q'],
  ])('%s is a 400 naming %s', async (path, param) => {
    const res = await admin.get(`/api/v1${path}`).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.issues.map((i: { path: string }) => i.path)).toContain(param);
  });
});
