import type { DbExecutor } from '../../client.js';
import { organizationCounters } from '../../schema/platform.js';
import { DEMO_BATCHES, DEMO_INVOICES } from './billing.js';
import { ALL_DEMO_LOAD_NUMBERS } from './loads.js';
import { DEMO_CLAIMS } from './safety.js';

// Human-number sequences (§7.2): each key's next value is the seeded maximum + 1,
// so the first load created after seeding is L-40223 (01 §3).

export const DEMO_COUNTERS: Readonly<Record<'load' | 'invoice' | 'invoice_batch' | 'claim', number>> = {
  load: Math.max(...ALL_DEMO_LOAD_NUMBERS) + 1,
  invoice: Math.max(...DEMO_INVOICES.map((i) => i.invoiceNumber)) + 1,
  invoice_batch: Math.max(...DEMO_BATCHES.map((b) => b.batchNumber)) + 1,
  claim: Math.max(...DEMO_CLAIMS.map((c) => c.claimNumber)) + 1,
};

export async function seedCounters(db: DbExecutor, organizationId: string): Promise<void> {
  await db.insert(organizationCounters).values(Object.entries(DEMO_COUNTERS).map(([key, nextValue]) => ({ organizationId, key, nextValue })));
}
