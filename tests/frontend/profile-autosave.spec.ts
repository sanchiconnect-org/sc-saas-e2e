/**
 * Journey 3 (SAN-1576): a startup edits a profile field and auto-save persists it.
 * Owner: Ritu Raj
 * Pass bar: the auto-save PATCH returns 2xx without clicking Save, and the new
 * value is still there after a reload.
 */
import { expect, test } from '@playwright/test';
import { memberAccount } from '../../config/accounts';
import { asRole } from '../../fixtures/auth';
import { StartupProfilePage } from '../../pages/frontend/StartupProfilePage';

test.describe('profile auto-save', { tag: ['@smoke', '@frontend', '@startup', '@write'] }, () => {
  test.skip(!memberAccount('startup'), 'QA_STARTUP_EMAIL not set');
  asRole('startup');

  test('editing Company Name auto-saves and survives a reload', async ({ page }) => {
    const profile = new StartupProfilePage(page);
    await profile.goto();

    const newName = `QA Startup ${Date.now()}`;
    const saved = profile.waitForStartupInfoSave();
    await profile.companyName.fill(newName);

    expect((await saved).ok(), 'auto-save PATCH /startups/startup-information').toBe(true);

    await page.reload();
    await expect(profile.companyName).toHaveValue(newName);
  });
});
