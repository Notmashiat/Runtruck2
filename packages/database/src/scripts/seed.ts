import { databaseEnvSchema, parseEnv } from '@runtruck/config';
import { createDatabase } from '../client.js';
import { findOrganizationByCompanyNumber } from '../seed/access.js';
import { DEMO_COMPANY_NUMBER, seedDemo } from '../seed/index.js';

// pnpm db:seed — loads the Runtruck1 demo dataset into DATABASE_URL.
// Development only (architecture §33): refuses production and never overwrites.

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data when NODE_ENV=production.');
  process.exit(1);
}
const password = process.env.SEED_DEMO_PASSWORD;
if (!password || password.length < 8) {
  console.error('Set SEED_DEMO_PASSWORD (at least 8 characters) in .env before seeding.');
  process.exit(1);
}

const env = parseEnv(databaseEnvSchema);
const handle = createDatabase(env.DATABASE_URL, { max: 2, applicationName: 'runtruck-seed' });
try {
  if (await findOrganizationByCompanyNumber(handle.db, DEMO_COMPANY_NUMBER)) {
    console.log('Demo organization already exists — nothing to do. Use `pnpm db:reset` to rebuild it.');
  } else {
    const { organizationId } = await seedDemo(handle.db, { password });
    console.log(`Seeded Sunridge Freight (${organizationId}). Sign in as rosa.medina@sunridgefreight.com with SEED_DEMO_PASSWORD.`);
  }
} finally {
  await handle.close();
}
