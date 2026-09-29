import { createDatabase, runMigrations } from '@runtruck/database';
import { seedDemo } from '@runtruck/database/seed';
import { truncateAll } from '@runtruck/database/testing';
import { sql } from 'drizzle-orm';
import { E2E } from './env.js';

// Before the browser tests: make sure the e2e database exists, bring it to the
// latest migration and load a fresh copy of the demo (docs/01 §4).
export default async function globalSetup(): Promise<void> {
  const target = new URL(E2E.databaseUrl);
  const dbName = target.pathname.slice(1);
  if (!/e2e|test/.test(dbName)) throw new Error(`Refusing to reset "${dbName}": the e2e database name must contain "e2e" or "test".`);

  const admin = new URL(target);
  admin.pathname = '/postgres';
  const server = createDatabase(admin.toString(), { max: 1, applicationName: 'runtruck-e2e-setup' });
  try {
    const exists = await server.db.execute(sql`select 1 from pg_database where datname = ${dbName}`);
    if (exists.rows.length === 0) await server.db.execute(sql.raw(`create database "${dbName}"`));
  } finally {
    await server.close();
  }

  const handle = createDatabase(E2E.databaseUrl, { max: 2, applicationName: 'runtruck-e2e-setup' });
  try {
    await runMigrations(handle.db);
    await truncateAll(handle.db);
    await seedDemo(handle.db, { password: E2E.password });
  } finally {
    await handle.close();
  }
}
