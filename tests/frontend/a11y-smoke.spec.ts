/**
 * SAN-1610: advisory axe-core checks on smoke journey landing states (member PWA).
 * Reports WCAG A/AA violations as JSON under a11y-reports/; does not fail the suite.
 * Owner: Ritu Raj
 */
import { expect, test } from '@playwright/test';
import { memberAccount } from '../../config/accounts';
import { runAxeAdvisory } from '../../fixtures/a11y';
import { asRole } from '../../fixtures/auth';
import { LoginPage, dashboardPathFor } from '../../pages/frontend/LoginPage';

const TAGS = ['@smoke', '@frontend', '@a11y'];

test.describe('a11y smoke (advisory): member login landing', { tag: TAGS }, () => {
  test('axe report for /auth/login', async ({ page }, testInfo) => {
    const login = new LoginPage(page);
    await login.goto();
    await expect(login.emailInput).toBeVisible();

    const report = await runAxeAdvisory(page, 'frontend-login', testInfo);
    console.log(
      `[a11y] frontend-login: ${report.violationCount} violation node(s), ` +
        `${report.duplicateLabelCount} duplicate-label node(s)`,
    );
    // Advisory: always pass. Baseline / zero duplicate-labels are tracked via the report artefact.
    expect(report.journey).toBe('frontend-login');
  });
});

test.describe('a11y smoke (advisory): startup dashboard landing', { tag: [...TAGS, '@startup'] }, () => {
  test.skip(!memberAccount('startup'), 'QA_STARTUP_EMAIL not set');
  asRole('startup');

  test('axe report for startup dashboard', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page).toHaveURL(dashboardPathFor('startup'));

    const report = await runAxeAdvisory(page, 'frontend-startup-dashboard', testInfo);
    console.log(
      `[a11y] frontend-startup-dashboard: ${report.violationCount} violation node(s), ` +
        `${report.duplicateLabelCount} duplicate-label node(s)`,
    );
    expect(report.journey).toBe('frontend-startup-dashboard');
  });
});
