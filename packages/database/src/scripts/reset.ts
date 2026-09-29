import { databaseEnvSchema, parseEnv } from '@runtruck/config';
import { createDatabase } from '../client.js';
import { runMigrations } from '../migrate.js';
import { seedDemo } from '../seed/index.js';
import { truncateAll } from '../testing/index.js';

// pnpm db:reset — DESTRUCTIVE: empties every table in DATABASE_URL, re-applies
// migrations and re-seeds the demo. Local development only; refuses production
// and any database whose name does not look local (architecture §33).

if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
  console.error(`Refusing to reset the database when NODE_ENV=${process.env.NODE_ENV}.`);
  process.exit(1);
}
const password = process.env.SEED_DEMO_PASSWORD;
if (!password || password.length < 8) {
  console.error('Set SEED_DEMO_PASSWORD (at least 8 characters) in .env before resetting.');
  process.exit(1);
}

const env = parseEnv(databaseEnvSchema);
const host = new URL(env.DATABASE_URL).hostname;
if (!['localhost', '127.0.0.1', '::1', 'postgres'].includes(host)) {
  console.error(`Refusing to reset a non-local database host (${host}).`);
  process.exit(1);
}

const handle = createDatabase(env.DATABASE_URL, { max: 2, applicationName: 'runtruck-reset' });
try {
  await runMigrations(handle.db);
  await truncateAll(handle.db);
  await seedDemo(handle.db, { password });
  console.log('Database reset and demo re-seeded.');
} finally {
  await handle.close();
}
