/**
 * Mentor regression path (SAN-1608): profile completion, connection request, meeting booking.
 * Owner: Ritu Raj
 */
import { expect, test } from '@playwright/test';
import { adminAccount, memberAccount } from '../../config/accounts';
import { asRole } from '../../fixtures/auth';
import { MentorProfilePage } from '../../pages/frontend/MentorProfilePage';
import {
  LOGO_PNG,
  bookMeetingWithStartup,
  sendConnectionRequest,
  skipFirstLoginModal,
} from './stakeholder-path-helpers';

const TAGS = ['@regression', '@frontend', '@mentor', '@write'] as const;

test.describe('mentor path: complete profile', { tag: [...TAGS] }, () => {
  test.skip(!memberAccount('mentor'), 'QA_MENTOR_EMAIL not set');
  asRole('mentor');

  test('required mentor-information fields save and clear Country is missing', async ({ page }) => {
    await skipFirstLoginModal(page);
    const runId = Date.now().toString();
    const profile = new MentorProfilePage(page);
    await profile.goto();

    await profile.pickNgSelect(profile.country, 'country');
    await profile.pickNgSelect(profile.state, 'state');
    if (await profile.city.count()) await profile.pickNgSelect(profile.city, 'city').catch(() => undefined);

    if (await profile.logoInput.count()) {
      await profile.logoInput.setInputFiles({
        name: `qa-mentor-${runId}.png`,
        mimeType: 'image/png',
        buffer: LOGO_PNG,
      });
      const preview = page.locator('ngb-modal-window').filter({ hasText: /Avatar|Preview|Crop/i });
      if (await preview.isVisible().catch(() => false)) {
        await preview.getByRole('button', { name: /^save$/i }).click();
      }
    }

    const save = profile.waitForSave();
    await profile.headline.fill(`QA mentor headline ${runId} ships guidance.`);
    await profile.about.fill(`QA mentor about ${runId}: helps startups with product and GTM.`);
    await profile.headline.blur();
    const response = await save;
    expect(response.ok(), `mentor save returned ${response.status()}`).toBe(true);
    await expect(profile.country.locator('.ng-value')).toHaveCount(1);

    await page.goto('/mentors/dashboard');
    await expect(page).toHaveURL(/\/mentors\/dashboard/);
    await expect(page.getByText('Country is missing')).toHaveCount(0);
  });
});

test.describe('mentor path: connection request', { tag: [...TAGS] }, () => {
  test.skip(!memberAccount('mentor'), 'QA_MENTOR_EMAIL not set');
  test.skip(!memberAccount('startup'), 'QA_STARTUP_EMAIL not set');
  test.skip(!adminAccount('admin'), 'QA admin required to approve profiles before connect');
  asRole('mentor');

  test('sends a connection request to the seeded startup when profiles are approved', async ({ page }) => {
    test.setTimeout(120_000);
    await skipFirstLoginModal(page);
    await page.goto('/connections');
    await expect(page).toHaveURL(/\/connections/);

    const res = await sendConnectionRequest('mentor', 'startup', `QA SAN-1608 mentor connect ${Date.now()}`);
    expect(res.ok, `connections/send/request → ${res.status} ${JSON.stringify(res.json)}`).toBe(true);
  });
});

test.describe('mentor path: meeting booking', { tag: [...TAGS] }, () => {
  test.skip(!memberAccount('mentor'), 'QA_MENTOR_EMAIL not set');
  test.skip(!memberAccount('startup'), 'QA_STARTUP_EMAIL not set');
  asRole('mentor');

  test('books a virtual meeting with the seeded startup', async ({ page }) => {
    await skipFirstLoginModal(page);
    const title = `QA SAN-1608 mentor meeting ${Date.now()}`;
    const created = await bookMeetingWithStartup('mentor', title);
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const data = (created.json.data ?? {}) as { meetingTitle?: string; meetingCode?: string };
    expect(data.meetingTitle).toBe(title);
    expect(data.meetingCode, 'meeting code issued').toBeTruthy();

    await page.goto('/mentors/dashboard');
    await expect(page.getByText('Upcoming Meetings').or(page.getByText('Meeting Requests')).first()).toBeVisible();
  });
});
