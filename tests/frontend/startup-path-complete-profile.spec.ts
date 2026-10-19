/**
 * Startup regression path, journey 2 of 5 (SAN-1606): the startup completes its profile.
 * Owner: Ritu Raj
 * Pass bar: every required Basic Information field (logo, city, elevator pitch, company brief,
 * product stage, business model, founder name) is filled, the "field(s) are not complete" counter is gone, NEXT STEP opens the
 * Industry/Technology tab without the "Please fill in all the required information" popup, and
 * the values are still there after a reload.
 *
 * The later tabs (Industry/Technology, Financials, Pitch Deck) stay locked until Basic Information
 * is complete, so this is the step that unlocks the rest of the profile. The values carry the run
 * id so each run's auto-save has something new to PATCH.
 */
import { expect, test } from '@playwright/test';
import { memberAccount } from '../../config/accounts';
import { asRole } from '../../fixtures/auth';
import { StartupProfilePage } from '../../pages/frontend/StartupProfilePage';

/* 1x1 PNG: the logo input accepts .png/.jpg/.jpeg up to 512 kB. */
const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('startup path: complete profile', { tag: ['@regression', '@frontend', '@startup', '@write'] }, () => {
  test.skip(!memberAccount('startup'), 'QA_STARTUP_EMAIL not set');
  asRole('startup');

  test('filling every required Basic Information field unlocks the next profile tab and persists', async ({ page }) => {
    const runId = Date.now().toString();
    const elevatorPitch = `We help QA startups (${runId}) ship faster by automating regression checks.`;
    const companyBrief = `QA regression startup ${runId}: builds automated test tooling for SaaS teams.`;
    const founderName = `QA Path Founder ${runId}`;

    const profile = new StartupProfilePage(page);
    await profile.goto();

    const incomplete = page.getByText(/field\(s\) are not complete yet/);
    const requiredPopup = page.getByText('Please fill in all the required information');
    const logoInput = page.locator('input[type=file][name=avatar]');
    const city = page.locator('ng-select#registeredCityId');
    const pitch = page.locator('textarea#elevatorPitch');
    const brief = page.locator('textarea#description');
    const productStage = page.locator('input[formcontrolname=productStageId]');
    const businessModel = page.locator('input[type=checkbox]#B2B');
    const founder = page.locator('input[formcontrolname=name]').first();

    await logoInput.setInputFiles({ name: `qa-logo-${runId}.png`, mimeType: 'image/png', buffer: LOGO_PNG });
    const avatarPreview = page.locator('ngb-modal-window').filter({ hasText: 'Avatar Preview' });
    const logoUploaded = page.waitForResponse(
      (r) => r.url().includes('/startups/upload/logo') && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await avatarPreview.getByRole('button', { name: /^save$/i }).click();
    const logo = await logoUploaded;
    expect(logo.ok(), `logo upload returned ${logo.status()}`).toBe(true);
    await expect(avatarPreview).toBeHidden({ timeout: 20_000 });

    for (const [id, label] of [
      ['registeredCountryId', 'country'],
      ['registeredStateId', 'state'],
      ['registeredCityId', 'city'],
    ] as const) {
      const select = page.locator(`ng-select#${id}`);
      if ((await select.locator('.ng-value').count()) > 0) continue;
      await select.click();
      const option = page.locator('ng-dropdown-panel .ng-option:not(.ng-option-disabled)').first();
      await expect(option, `no ${label} options to choose from`).toBeVisible({ timeout: 15_000 });
      await option.click();
      await expect(select.locator('.ng-value'), `${label} not selected`).toHaveCount(1);
    }

    /* Each section auto-saves to its own endpoint; these carry the run id. */
    const saves = ['/startups/pitch-deck', '/startups/product-information', '/startups/founders/'].map((endpoint) =>
      page
        .waitForResponse(
          (r) =>
            r.url().includes(endpoint) && r.request().method() === 'PATCH' && (r.request().postData() ?? '').includes(runId),
          { timeout: 30_000 },
        )
        .then((r) => ({ endpoint, r })),
    );
    if (!(await businessModel.isChecked())) {
      saves.push(
        page
          .waitForResponse((r) => r.url().includes('/startups/industry-technology-business') && r.request().method() === 'PATCH', {
            timeout: 30_000,
          })
          .then((r) => ({ endpoint: '/startups/industry-technology-business', r })),
      );
      await businessModel.check({ force: true });
    }
    await pitch.fill(elevatorPitch);
    await brief.fill(companyBrief);
    await productStage.nth(1).check({ force: true });
    await founder.fill(founderName);
    for (const { endpoint, r } of await Promise.all(saves)) {
      expect(r.ok(), `auto-save PATCH ${endpoint} returned ${r.status()}`).toBe(true);
    }

    await expect(incomplete, 'required fields still reported incomplete').toBeHidden({ timeout: 20_000 });

    await page.getByRole('button', { name: /next step/i }).click();
    await expect(requiredPopup).toBeHidden();
    await expect(page).not.toHaveURL(/startup-information/, { timeout: 20_000 });

    await profile.goto();
    await expect(pitch).toHaveValue(elevatorPitch);
    await expect(brief).toHaveValue(companyBrief);
    await expect(businessModel).toBeChecked();
    await expect(founder).toHaveValue(founderName);
    await expect(productStage.nth(1)).toBeChecked();
    await expect(city.locator('.ng-value')).toHaveCount(1);
    await expect(incomplete).toBeHidden();
  });
});
