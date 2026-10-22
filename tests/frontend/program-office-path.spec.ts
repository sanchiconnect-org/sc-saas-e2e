/**
 * Program-office regression path (SAN-1607 PWA half): dashboard + CFA list.
 * Owner: Ritu Raj
 *
 * Program-office members have no admin CFA controls (create program / allot jury / approve).
 * That loop is covered by `tests/cfa/admin-path.spec.ts`. This journey checks the PO can sign
 * in (via setup), reach their dashboard, and open Call for Applications.
 */
import { expect, test } from '@playwright/test';
import { memberAccount } from '../../config/accounts';
import { asRole } from '../../fixtures/auth';
import { CallForApplicationsPage } from '../../pages/frontend/cfa/CallForApplicationsPage';

const TAGS = ['@regression', '@frontend', '@program_office'] as const;

test.describe('program-office path', { tag: [...TAGS] }, () => {
  test.skip(!memberAccount('program_office'), 'QA_PROGRAM_OFFICE_EMAIL not set');
  asRole('program_office');

  test('dashboard loads and Call for Applications is reachable', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('skip-first-login-modal', 'true'));
    await page.goto('/program-office-members/dashboard');
    await expect(page).toHaveURL(/\/program-office-members\/dashboard/);

    const cfa = new CallForApplicationsPage(page);
    const list = await cfa.goto();
    expect(list.ok(), `application-programs-management → ${list.status()}`).toBe(true);
    await expect(page).toHaveURL(/\/call-for-applications/);
    await expect(cfa.sectionButton('Active')).toBeVisible();
  });
});
