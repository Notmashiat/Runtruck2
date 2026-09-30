// Settings shared by the Playwright config, its global setup and the specs.
// E2E runs against its OWN database and ports, so it never touches dev data.

try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // CI provides the environment directly.
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
}

const devUrl = new URL(process.env.E2E_DATABASE_URL ?? required('DATABASE_URL'));
if (!process.env.E2E_DATABASE_URL) devUrl.pathname = '/runtruck_e2e';

// E2E uses its own Redis database index (sign-in throttling counters, queues), so
// repeated runs never trip the dev environment's limits or read its keys.
const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
redisUrl.pathname = '/10';

export const E2E = {
  redisUrl: redisUrl.toString(),
  databaseUrl: devUrl.toString(),
  apiPort: 4000,
  webPort: 3000,
  webOrigin: 'http://localhost:3000',
  // Test-only password given to the seeded demo accounts in the e2e database.
  password: process.env.E2E_PASSWORD ?? 'e2e-password-not-a-secret',
  adminEmail: 'rosa.medina@sunridgefreight.com',
  // The bucket the e2e servers store documents in, apart from the dev bucket.
  bucket: 'runtruck-documents-test',
} as const;
