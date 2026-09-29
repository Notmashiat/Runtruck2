import type { DbExecutor } from '../../client.js';

export interface DemoSeedContext {
  organizationId: string;
  // Rosa Medina — recorded as the actor on seeded activity/audit rows.
  adminUserId: string;
}

// Inserts every Runtruck1 business record for the demo organization, per the
// seed mapping in docs/03-database.md. Implemented domain by domain.
export async function seedDemoData(_db: DbExecutor, _ctx: DemoSeedContext): Promise<void> {
  // Filled in by the domain seed modules.
}
