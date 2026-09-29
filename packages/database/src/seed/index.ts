import type { Database } from '../client.js';
import { createMember, createOrganizationWithRoles, ensurePermissionCatalog } from './access.js';
import { seedDemoData } from './demo/index.js';

// The Runtruck1 demo dataset (docs/01-product-requirements.md §4,
// docs/03-database.md seed mapping): Sunridge Freight, Rosa Medina (Admin), and
// every Runtruck1 record as normalized rows.

export interface SeedOptions {
  // Password for the demo account(s). Development/test only.
  password: string;
}

export const DEMO_COMPANY_NUMBER = '30017';

export async function seedDemo(db: Database, options: SeedOptions): Promise<{ organizationId: string; adminUserId: string }> {
  return db.transaction(async (tx) => {
    await ensurePermissionCatalog(tx);
    const { organizationId, roleIds } = await createOrganizationWithRoles(tx, {
      name: 'Sunridge Freight',
      shortName: 'Sunridge',
      companyNumber: DEMO_COMPANY_NUMBER,
      timezone: 'America/Los_Angeles',
      mcNumber: 'MC 812044',
      dotNumber: 'DOT 2291176',
    });
    const adminUserId = await createMember(
      tx,
      organizationId,
      roleIds,
      { email: 'rosa.medina@sunridgefreight.com', fullName: 'Rosa Medina', memberNumber: '100482731', title: 'Dispatch', role: 'admin' },
      options.password,
    );
    await seedDemoData(tx, { organizationId, adminUserId });
    return { organizationId, adminUserId };
  });
}
