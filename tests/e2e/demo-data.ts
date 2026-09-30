import { createDatabase } from '@runtruck/database';
import { seedDemo, seedStorageConfigFromEnv, uploadSeedDocuments } from '@runtruck/database/seed';
import { truncateAll } from '@runtruck/database/testing';
import { sql } from 'drizzle-orm';
import { E2E } from './env.js';

// Loads a fresh copy of the demo (docs/01 §4) into the e2e database and puts the seeded
// versions' placeholder PDFs in the e2e bucket. globalSetup runs it once per run; specs
// that change data (New Load, Payroll, Planner) or assert seed figures run it in
// beforeAll, so every spec starts from the same state whatever order the files run in.
// Sessions are truncated too, so each test signs in again.
export async function resetDemoData(): Promise<void> {
  const handle = createDatabase(E2E.databaseUrl, { max: 2, applicationName: 'runtruck-e2e-reset' });
  try {
    await truncateAll(handle.db);
    await seedDemo(handle.db, { password: E2E.password });
    const storage = seedStorageConfigFromEnv();
    if (storage) await uploadSeedDocuments(handle.db, { ...storage, bucket: E2E.bucket });
  } finally {
    await handle.close();
  }
}

// The `next` state of the latest audit entry for an action on an entity ("L-40223"), read
// straight from the e2e database: effects the UI does not show, such as the non-blocking
// compliance warnings recorded at dispatch (brief §8 C27).
export async function latestAuditNext(action: string, entityLabel: string): Promise<unknown> {
  const handle = createDatabase(E2E.databaseUrl, { max: 1, applicationName: 'runtruck-e2e-check' });
  try {
    const result = await handle.db.execute<{ next: unknown }>(
      sql`select next from audit_logs where action = ${action} and entity_label = ${entityLabel} order by occurred_at desc limit 1`,
    );
    return result.rows[0]?.next;
  } finally {
    await handle.close();
  }
}
