import { loadDotEnv } from './env.js';
import { createDatabase, runMigrations } from '@runtruck/database';
import { sql } from 'drizzle-orm';

// Runs once before the integration suite: points the app at TEST_DATABASE_URL
// and rebuilds its schema from the migrations, so tests start from exactly what
// production would run. Never touches DATABASE_URL (architecture §33).
export default async function setup(): Promise<void> {
  loadDotEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example). Integration tests need the docker compose Postgres.');
  if (!new URL(url).pathname.includes('test')) throw new Error('TEST_DATABASE_URL must name a test database (its name must contain "test").');

  const handle = createDatabase(url, { max: 1, applicationName: 'runtruck-test-setup' });
  try {
    await handle.db.execute(sql`drop schema if exists public cascade`);
    await handle.db.execute(sql`drop schema if exists drizzle cascade`);
    await handle.db.execute(sql`create schema public`);
    await runMigrations(handle.db);
  } finally {
    await handle.close();
  }
}
