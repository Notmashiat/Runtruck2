import { defineConfig, devices } from '@playwright/test';
import { E2E } from './env.js';

// Real user workflows in a real browser against the built apps (architecture §31).
// Prerequisites: `pnpm infra:up` and `pnpm build`. Ports 3000/4000 must be free:
// the suite starts its own API, worker and web server on the e2e database.
const serverEnv = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: E2E.databaseUrl,
  DEMO_TODAY: '2026-09-03',
  API_PORT: String(E2E.apiPort),
  WEB_ORIGIN: E2E.webOrigin,
  API_ORIGIN: `http://localhost:${E2E.apiPort}`,
  S3_BUCKET: E2E.bucket,
  REDIS_URL: E2E.redisUrl,
} as Record<string, string>;

export default defineConfig({
  testDir: './specs',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: E2E.webOrigin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
    timezoneId: 'America/Los_Angeles',
    locale: 'en-US',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: 'pnpm --filter @runtruck/api start',
      // Playwright starts the web servers BEFORE globalSetup, which creates and migrates
      // the e2e database. So wait for the port, not /health (which needs that database);
      // the pool connects lazily, and globalSetup fails loudly if PostgreSQL is down.
      port: E2E.apiPort,
      env: serverEnv,
      reuseExistingServer: false,
      timeout: 120_000,
      cwd: '../..',
    },
    {
      command: 'pnpm --filter @runtruck/api start:worker',
      env: serverEnv,
      reuseExistingServer: false,
      cwd: '../..',
      wait: { stdout: /Worker started/ },
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @runtruck/web start',
      url: E2E.webOrigin,
      env: serverEnv,
      reuseExistingServer: false,
      timeout: 120_000,
      cwd: '../..',
    },
  ],
});
