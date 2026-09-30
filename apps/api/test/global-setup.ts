import { createDatabase, runMigrations } from '@runtruck/database';
import { sql } from 'drizzle-orm';
import { loadDotEnv } from './env.js';

// Runs once before the integration suite: points the app at TEST_DATABASE_URL
// and rebuilds its schema from the migrations, so tests start from exactly what
// production would run. Never touches DATABASE_URL (architecture §33). The
// database is created when missing, so parallel runs can each use their own
// (e.g. TEST_DATABASE_URL=…/runtruck_test_loads).
export default async function setup(): Promise<void> {
  loadDotEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example). Integration tests need the docker compose Postgres.');
  const target = new URL(url);
  const dbName = target.pathname.slice(1);
  if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(dbName)) throw new Error('TEST_DATABASE_URL must name a test database (lower-case, containing "test").');

  const admin = new URL(target);
  admin.pathname = '/postgres';
  const server = createDatabase(admin.toString(), { max: 1, applicationName: 'runtruck-test-setup' });
  try {
    const exists = await server.db.execute(sql`select 1 from pg_database where datname = ${dbName}`);
    if (exists.rows.length === 0) await server.db.execute(sql.raw(`create database "${dbName}"`));
  } finally {
    await server.close();
  }

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
