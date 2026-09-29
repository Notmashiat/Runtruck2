import type { INestApplication } from '@nestjs/common';
import { createDatabase, type DatabaseHandle } from '@runtruck/database';
import { FIXTURE_USERS, seedTestFixtures, TEST_PASSWORD, truncateAll, type FixtureOrganizations } from '@runtruck/database/testing';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { createApp } from '../src/create-app.js';
import { loadDotEnv } from './env.js';
import { REDIS } from '../src/redis/redis.module.js';

// Shared integration-test harness. Tests go through the real HTTP stack
// (middleware, guards, filters, interceptors) via supertest (architecture §31).

export { FIXTURE_USERS, TEST_PASSWORD };
export type FixtureUser = keyof typeof FIXTURE_USERS;

export const WEB_ORIGIN = 'http://localhost:3000';

function useTestEnvironment(): void {
  loadDotEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = url;
  process.env.DEMO_TODAY = '2026-09-03';
  process.env.WEB_ORIGIN = WEB_ORIGIN;
  if (process.env.S3_BUCKET) process.env.S3_BUCKET = `${process.env.S3_BUCKET.replace(/-test$/, '')}-test`;
}

export interface TestContext {
  app: INestApplication;
  db: DatabaseHandle;
  orgs: FixtureOrganizations;
  // A supertest agent that holds the session cookie of the given fixture user.
  as: (user: FixtureUser) => Promise<ReturnType<typeof request.agent>>;
  close: () => Promise<void>;
}

// Boots the app against a freshly re-seeded test database. Call once per file
// (beforeAll) — writes made by one test file never leak into the next.
export async function createTestContext(): Promise<TestContext> {
  useTestEnvironment();
  const db = createDatabase(process.env.DATABASE_URL ?? '', { max: 4, applicationName: 'runtruck-test' });
  await truncateAll(db.db);
  const orgs = await seedTestFixtures(db.db);

  const app = await createApp(false);
  await app.init();
  // Sign-in throttling counters must not leak between test files.
  await app.get<Redis>(REDIS).flushdb();

  const as = async (user: FixtureUser) => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/login').send({ email: FIXTURE_USERS[user], password: TEST_PASSWORD }).expect(200);
    return agent;
  };

  return {
    app,
    db,
    orgs,
    as,
    close: async () => {
      await app.close();
      await db.close();
    },
  };
}
