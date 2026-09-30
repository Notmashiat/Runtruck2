import { databaseEnvSchema, parseEnv } from '@runtruck/config';
import { createDatabase } from '../client.js';
import { runMigrations } from '../migrate.js';

const env = parseEnv(databaseEnvSchema);
const handle = createDatabase(env.DATABASE_URL, { max: 1, applicationName: 'runtruck-migrate' });
try {
  await runMigrations(handle.db);
  console.log('Migrations applied.');
} finally {
  await handle.close();
}
