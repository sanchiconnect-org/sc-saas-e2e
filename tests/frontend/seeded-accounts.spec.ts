/**
 * Every seeded stakeholder account can open its dashboard with the session the
 * setup project saved — the acceptance check for the QA tenant (SAN-1581).
 * Owner: Ritu Raj
 */
import { expect, test } from '@playwright/test';
import { MEMBER_ROLES, memberAccount } from '../../config/accounts';
import { asRole } from '../../fixtures/auth';
import { dashboardPathFor } from '../../pages/frontend/LoginPage';

for (const role of MEMBER_ROLES) {
  test.describe(`seeded ${role}`, { tag: ['@smoke', '@frontend', `@${role}`] }, () => {
    test.skip(!memberAccount(role), `QA_${role.toUpperCase()}_EMAIL not set`);
    asRole(role);

    test(`${role} session opens the dashboard`, async ({ page }) => {
      await page.goto('/');
      await expect(page).toHaveURL(dashboardPathFor(role));
    });
  });
}
