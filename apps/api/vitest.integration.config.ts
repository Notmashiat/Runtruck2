import { defineConfig } from 'vitest/config';
import { swcPlugin } from './vitest.swc.js';

// Integration tests: real PostgreSQL (TEST_DATABASE_URL) and Redis (REDIS_URL),
// exercised through HTTP with supertest (architecture §31).
export default defineConfig({
  plugins: [await swcPlugin()],
  test: {
    include: ['test/**/*.int.test.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    // One database: files run one after another so fixtures never interleave.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
