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
    /* Logs in once per seeded account and saves the browser state to .auth/<role>.json */
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: env.frontendUrl },
    },
    {
      name: 'frontend',
      testDir: './tests/frontend',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], baseURL: env.frontendUrl },
    },
    {
      name: 'admin',
      testDir: './tests/admin',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], baseURL: env.adminUrl },
    },
  ],
});
