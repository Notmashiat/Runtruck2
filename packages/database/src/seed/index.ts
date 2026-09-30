import type { Database } from '../client.js';
import { createMember, createOrganizationWithRoles, ensurePermissionCatalog } from './access.js';
import { seedDemoData } from './demo/index.js';

// Shared with the API: Reset calendar inserts the organization's defaults with the seed's
// function (docs/api/planner.md §3.11); the documents module reads the seeded placeholder
// constants (docs/13-document-system.md §7).
export {
  documentStorageKey,
  insertDefaultColorCodes,
  insertPlannerDefaults,
  PLACEHOLDER_PDF,
  PLACEHOLDER_PDF_MIME,
  PLACEHOLDER_PDF_SHA256,
} from './demo/index.js';
export type { PlannerDefaultSet, PlannerDefaultsResult } from './demo/index.js';

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
      // Digits only, as on the own-fleet carriers row (03 §2.1, §7.1).
      mcNumber: '812044',
      dotNumber: '2291176',
      // Reset calendar restores Runtruck1's demo events for this organization only (D8).
      plannerDefaults: 'runtruck1_demo',
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
