import { defineConfig, devices } from '@playwright/test';
import { E2E_DB_URL } from './tests/e2e/db-path';

/**
 * Playwright E2E configuration. Specs live in tests/e2e.
 *
 * Hermetic database (Task 20): `globalSetup` provisions a fresh, migrated and
 * seeded ephemeral SQLite database, and the dev server started by `webServer`
 * is pointed at that SAME database via `env.DATABASE_URL` — so the running app
 * and the seeded data are always in lock-step, and the developer's real
 * `data/lexical.db` is never touched. `globalTeardown` removes the temp DB.
 *
 * The dev server is started automatically for local runs; reuse it if already
 * running. NOTE: when reusing an already-running server, that server must have
 * been started against the E2E database for the data-dependent specs to pass.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Point the dev server at the isolated, seeded E2E database. Next.js does
    // not override env vars already present in the process environment, so this
    // takes precedence over the DATABASE_URL in .env.
    env: { DATABASE_URL: E2E_DB_URL },
  },
});
