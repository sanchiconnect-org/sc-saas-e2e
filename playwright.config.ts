import { defineConfig, devices } from '@playwright/test';
import { env } from './config/env';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  /* One retry in CI; a test that passes only on retry is reported as flaky and must be quarantined the same day. */
  retries: isCI ? 1 : 0,
  workers: isCI ? 4 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  /* Production runs are read-only: anything that creates or changes data is tagged @write and skipped there. */
  grepInvert: env.allowWrites ? undefined : /@write/,
  reporter: isCI
    ? [['github'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    /* SAN-1609: cockpit API contracts (no browser session). Runs in nightly full suite and via
       `npm run test:contracts` after deploys — keep free of setup deps so deploy logs stay fast. */
    {
      name: 'api',
      testDir: './tests/api',
      use: { ...devices['Desktop Chrome'], baseURL: env.frontendUrl },
    },
    /* The login journey does real UI logins, so it runs BEFORE any session is saved:
       with single_session_login_enabled a new login kills that user's older session. */
    {
      name: 'login',
      testDir: './tests/frontend',
      testMatch: /login-otp\.spec\.ts/,
      timeout: 180_000,
      use: { ...devices['Desktop Chrome'], baseURL: env.frontendUrl },
    },
    /* Log in once per seeded account and save the browser state to .auth/<role>.json.
       Split so a broken admin login never blocks the PWA journeys, and vice versa. */
    {
      name: 'setup-frontend',
      dependencies: ['login'],
      testMatch: /frontend\.setup\.ts/,
      /* room for one 61s wait on the login rate limit (see LoginPage.requestOtp) */
      timeout: 180_000,
      use: { ...devices['Desktop Chrome'], baseURL: env.frontendUrl },
    },
    {
      name: 'setup-admin',
      testMatch: /admin\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: env.adminUrl },
    },
    {
      name: 'frontend',
      testDir: './tests/frontend',
      testIgnore: /login-otp\.spec\.ts/,
      dependencies: ['setup-frontend'],
      use: { ...devices['Desktop Chrome'], baseURL: env.frontendUrl },
    },
    {
      name: 'admin',
      testDir: './tests/admin',
      dependencies: ['setup-admin'],
      use: { ...devices['Desktop Chrome'], baseURL: env.adminUrl },
    },
    /* CFA regression suite (FT-006). cfa-setup creates this run's test-mode program (.cfa/run.json);
       cfa-teardown deletes it, plus throwaways and >24h orphans, after every cfa test has finished. */
    {
      name: 'cfa-setup',
      testMatch: /cfa\.setup\.ts/,
      dependencies: ['setup-admin'],
      teardown: 'cfa-teardown',
      use: { ...devices['Desktop Chrome'], baseURL: env.adminUrl },
    },
    {
      name: 'cfa-teardown',
      testMatch: /cfa\.teardown\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: env.adminUrl },
    },
    /* Each CFA test spans the admin panel and the PWA, so it needs both saved sessions.
       baseURL is the PWA; admin pages go through fixtures/cfa.ts or an explicit env.adminUrl. */
    {
      name: 'cfa',
      testDir: './tests/cfa',
      dependencies: ['setup-frontend', 'setup-admin', 'cfa-setup'],
      use: { ...devices['Desktop Chrome'], baseURL: env.frontendUrl },
    },
    /* Journeys that set data up in the admin panel and run on the PWA (one-on-one event booking).
       Needs both saved sessions; baseURL is the PWA, admin calls go through CfaAdmin. */
    {
      name: 'cross',
      testDir: './tests/cross',
      dependencies: ['setup-frontend', 'setup-admin'],
      use: { ...devices['Desktop Chrome'], baseURL: env.frontendUrl },
    },
  ],
});
