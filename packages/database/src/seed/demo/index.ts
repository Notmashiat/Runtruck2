import type { DbExecutor } from '../../client.js';
import { seedBilling } from './billing.js';
import { seedCarriers } from './carriers.js';
import { seedCounters } from './counters.js';
import { seedCustomers } from './customers.js';
import { seedDocuments } from './documents.js';
import { seedFacilities } from './facilities.js';
import { seedFleet } from './fleet.js';
import { seedEmployees, seedHr } from './hr.js';
import { seedLoads } from './loads.js';
import { seedPayables } from './payables.js';
import { insertPlannerDefaults } from './planner.js';
import { emptyRefs } from './refs.js';
import { seedSafety } from './safety.js';
import { seedSettlements } from './settlements.js';

export { insertDefaultColorCodes, insertPlannerDefaults } from './planner.js';
export type { PlannerDefaultSet, PlannerDefaultsResult } from './planner.js';
export { documentStorageKey, PLACEHOLDER_PDF, PLACEHOLDER_PDF_MIME, PLACEHOLDER_PDF_SHA256 } from './documents.js';

export interface DemoSeedContext {
  organizationId: string;
  // Rosa Medina's user: linked to her employee row (docs/03-database.md §7.6). The
  // seed is not a user action, so seeded actor/user columns stay null and it writes
  // no audit_logs or events rows (§7).
  adminUserId: string;
}

// Inserts every Runtruck1 business record for the demo organization, per the seed
// mapping in docs/03-database.md §7, one module per domain, in dependency order.
// Runs inside seedDemo's transaction.
export async function seedDemoData(db: DbExecutor, ctx: DemoSeedContext): Promise<void> {
  const refs = emptyRefs(ctx.organizationId, ctx.adminUserId);
  await seedCustomers(db, refs);
  await seedCarriers(db, refs);
  await seedFacilities(db, refs);
  await seedEmployees(db, refs);
  await seedHr(db, refs);
  await seedFleet(db, refs);
  await seedLoads(db, refs);
  await seedDocuments(db, refs);
  await seedBilling(db, refs);
  await seedPayables(db, refs);
  await seedSettlements(db, refs);
  await seedSafety(db, refs);
  await insertPlannerDefaults(db, ctx.organizationId);
  await seedCounters(db, ctx.organizationId);
}
