import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { seedAccess } from '../seed/access.js';
import { seedDemo, type SeedOptions } from '../seed/index.js';
import { seedOtherOrganizationData } from './other-organization.js';

export { OTHER_ORG_FIXTURE } from './other-organization.js';

// Test-only helpers (never used by the app). Fixtures add a SECOND organization
// and role-limited users so integration tests can prove tenant isolation and
// permission denials (architecture §2 Rule 3, §31).

export const TEST_PASSWORD = 'test-password-not-a-secret';

export const FIXTURE_USERS = {
  // Demo organization (Sunridge Freight)
  admin: 'rosa.medina@sunridgefreight.com',
  dispatcher: 'dispatcher@sunridgefreight.test',
  driver: 'driver@sunridgefreight.test',
  accounting: 'accounting@sunridgefreight.test',
  // Second tenant
  otherAdmin: 'owner@testcarrier.test',
} as const;

// Removes every row from every table in the public schema (keeps migrations).
export async function truncateAll(db: Database): Promise<void> {
  const result = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
  const tables = result.rows.map((r) => `"public"."${r.tablename}"`);
  if (tables.length === 0) return;
  // audit_logs is append-only via trigger; TRUNCATE is not UPDATE/DELETE, so it is allowed.
  await db.execute(sql.raw(`truncate table ${tables.join(', ')} restart identity cascade`));
}

export interface FixtureOrganizations {
  demoOrganizationId: string;
  otherOrganizationId: string;
}

// Demo seed + the second tenant (with at least one row in every tenant-owned domain
// table, so tenancy tests can prove isolation) + role-limited users, all with TEST_PASSWORD.
export async function seedTestFixtures(db: Database, options: Partial<SeedOptions> = {}): Promise<FixtureOrganizations> {
  const demo = await seedDemo(db, { password: TEST_PASSWORD, ...options });
  const access = await seedAccess(db, {
    password: TEST_PASSWORD,
    demoOrganizationId: demo.organizationId,
    users: [
      { email: FIXTURE_USERS.dispatcher, fullName: 'Dana Dispatch', memberNumber: '100482732', title: 'Dispatch', role: 'dispatcher' },
      { email: FIXTURE_USERS.driver, fullName: 'Drew Driver', memberNumber: '100482733', title: 'Driver', role: 'driver' },
      { email: FIXTURE_USERS.accounting, fullName: 'Avery Accounts', memberNumber: '100482734', title: 'Accounting', role: 'accounting' },
    ],
    otherOrganization: {
      name: 'Test Carrier Co',
      shortName: 'Test Carrier',
      companyNumber: '40001',
      timezone: 'America/Chicago',
      owner: { email: FIXTURE_USERS.otherAdmin, fullName: 'Olivia Owner', memberNumber: '200000001', title: 'Owner', role: 'owner' },
    },
  });
  await db.transaction((tx) => seedOtherOrganizationData(tx, access.otherOrganizationId));
  return { demoOrganizationId: demo.organizationId, otherOrganizationId: access.otherOrganizationId };
}
