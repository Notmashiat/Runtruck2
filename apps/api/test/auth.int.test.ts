import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, FIXTURE_USERS, TEST_PASSWORD, type TestContext, WEB_ORIGIN } from './helpers.js';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(async () => {
  await t.close();
});

describe('authentication', () => {
  it('signs in, sets an httpOnly session cookie and returns the session', async () => {
    const res = await request(t.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'Rosa.Medina@SunridgeFreight.com', password: TEST_PASSWORD })
      .expect(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/rt_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(res.body.data.user).toMatchObject({ fullName: 'Rosa Medina', memberNumber: '100482731', title: 'Dispatch' });
    expect(res.body.data.organization).toMatchObject({ name: 'Sunridge Freight', companyNumber: '30017', timezone: 'America/Los_Angeles' });
    expect(res.body.data.today).toBe('2026-09-03');
    expect(res.body.data.permissions).toContain('loads.create');
    expect(res.body.meta).toEqual({});
  });

  it('rejects a wrong password with the same message as an unknown email', async () => {
    const server = t.app.getHttpServer();
    const wrong = await request(server).post('/api/v1/auth/login').send({ email: FIXTURE_USERS.admin, password: 'nope' }).expect(401);
    const unknown = await request(server).post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'nope' }).expect(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
    expect(wrong.body.error.requestId).toBeTruthy();
  });

  it('validates the login body', async () => {
    const res = await request(t.app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'x' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.issues.map((i: { path: string }) => i.path)).toEqual(['email', 'password']);
  });

  it('requires a session for protected routes', async () => {
    const res = await request(t.app.getHttpServer()).get('/api/v1/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('logs out and revokes the session server-side', async () => {
    const agent = await t.as('admin');
    await agent.get('/api/v1/me').expect(200);
    await agent.post('/api/v1/auth/logout').expect(200);
    await agent.get('/api/v1/me').expect(401);
  });

  it('rejects state-changing requests from another origin', async () => {
    const agent = await t.as('admin');
    const res = await agent.post('/api/v1/auth/logout').set('Origin', 'https://evil.example').expect(403);
    expect(res.body.error.code).toBe('CROSS_ORIGIN_REJECTED');
    await agent.post('/api/v1/auth/logout').set('Origin', WEB_ORIGIN).expect(200);
  });

  it('writes an append-only audit trail', async () => {
    const { sql } = await import('drizzle-orm');
    await expect(t.db.db.execute(sql`update audit_logs set action = 'TAMPERED'`)).rejects.toThrow();
    await expect(t.db.db.execute(sql`delete from audit_logs`)).rejects.toThrow();
  });

  it('exposes readiness without leaking details', async () => {
    const res = await request(t.app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.data).toEqual({ status: 'ok', database: 'ok', redis: 'ok' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});
