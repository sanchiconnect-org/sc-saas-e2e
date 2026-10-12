/**
 * Journey 8 (SAN-1576): a partner spoke domain resolves to its tenant and the PWA works there.
 * Owner: Ritu Raj
 * Pass bar: the spoke's resolve-domain call returns 200 and its login page renders.
 *
 * The cockpit only resolves hostnames on its registered-domains list (SAN-557), so
 * SPOKE_URL must be a spoke that is registered in this environment's cockpit.
 */
import { expect, test } from '@playwright/test';
import { env } from '../../config/env';
import { LoginPage } from '../../pages/frontend/LoginPage';

test.describe('spoke domain', { tag: ['@smoke', '@frontend', '@tenant'] }, () => {
  test.skip(!env.spokeUrl, 'SPOKE_URL not set');

  test('the spoke resolves its tenant and shows the login page', async ({ page }) => {
    const spokeHost = new URL(env.spokeUrl!).hostname;
    const resolved = page.waitForResponse((r) => r.url().includes(`/resolve-domain/${spokeHost}`));

    await page.goto(`${env.spokeUrl}/auth/login`);

    expect((await resolved).status(), `resolve-domain for ${spokeHost}`).toBe(200);
    await expect(new LoginPage(page).title).toBeVisible();
  });
});
