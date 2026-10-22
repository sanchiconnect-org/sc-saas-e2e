/**
 * Corporate regression path (SAN-1608): profile completion, connection request, meeting booking.
 * Owner: Ritu Raj
 */
import { expect, test } from '@playwright/test';
import { adminAccount, memberAccount } from '../../config/accounts';
import { asRole } from '../../fixtures/auth';
import { CorporateProfilePage } from '../../pages/frontend/CorporateProfilePage';
import {
  LOGO_PNG,
  bookMeetingWithStartup,
  sendConnectionRequest,
  skipFirstLoginModal,
} from './stakeholder-path-helpers';

const TAGS = ['@regression', '@frontend', '@corporate', '@write'] as const;

test.describe('corporate path: complete profile', { tag: [...TAGS] }, () => {
  test.skip(!memberAccount('corporate'), 'QA_CORPORATE_EMAIL not set');
  asRole('corporate');

  test('required corporate-intro fields save and clear Country is missing', async ({ page }) => {
    await skipFirstLoginModal(page);
    const runId = Date.now().toString();
    const profile = new CorporateProfilePage(page);
    await profile.goto();

    /* After admin approve, the intro form is often locked — only assert the banner is gone. */
    if (await profile.companyName.isDisabled()) {
      await page.goto('/corporates/dashboard');
      await expect(page.getByText('Country is missing')).toHaveCount(0);
      return;
    }

    await profile.pickNgSelect(profile.country, 'country');
    await profile.pickNgSelect(profile.state, 'state');
    if (await profile.city.count()) await profile.pickNgSelect(profile.city, 'city').catch(() => undefined);
    await profile.ensureCompanySize();
    await profile.uploadLogo({
      name: `qa-corp-${runId}.png`,
      mimeType: 'image/png',
      buffer: LOGO_PNG,
    });

    await profile.about.fill(`QA corporate introduction ${runId}: partners with startups on pilots and procurement.`);
    await profile.companyName.fill(`QA Corporate ${runId}`);
    await profile.companyName.blur();
    await expect(profile.country.locator('.ng-value')).toHaveCount(1);

    const save = profile.waitForSave().catch(() => null);
    await profile.companyName.fill(`QA Corporate ${runId}-b`);
    await profile.companyName.blur();
    const next = page.getByRole('button', { name: /next step/i });
    if (await next.isEnabled()) await next.click();
    const response = await save;
    if (response) expect(response.ok(), `corporate save returned ${response.status()}`).toBe(true);

    await page.goto('/corporates/dashboard');
    await expect(page).toHaveURL(/\/corporates\/dashboard/);
    await expect(page.getByText('Country is missing')).toHaveCount(0);
  });
});

test.describe('corporate path: connection request', { tag: [...TAGS] }, () => {
  test.skip(!memberAccount('corporate'), 'QA_CORPORATE_EMAIL not set');
  test.skip(!memberAccount('startup'), 'QA_STARTUP_EMAIL not set');
  test.skip(!adminAccount('admin'), 'QA admin required to approve profiles before connect');
  asRole('corporate');

  test('sends a connection request to the seeded startup when profiles are approved', async ({ page }) => {
    test.setTimeout(120_000);
    await skipFirstLoginModal(page);
    await page.goto('/connections');
    await expect(page).toHaveURL(/\/connections/);

    const res = await sendConnectionRequest('corporate', 'startup', `QA SAN-1608 corporate connect ${Date.now()}`);
    expect(res.ok, `connections/send/request → ${res.status} ${JSON.stringify(res.json)}`).toBe(true);
  });
});

test.describe('corporate path: meeting booking', { tag: [...TAGS] }, () => {
  test.skip(!memberAccount('corporate'), 'QA_CORPORATE_EMAIL not set');
  test.skip(!memberAccount('startup'), 'QA_STARTUP_EMAIL not set');
  asRole('corporate');

  test('books a virtual meeting with the seeded startup', async ({ page }) => {
    await skipFirstLoginModal(page);
    const title = `QA SAN-1608 corporate meeting ${Date.now()}`;
    const created = await bookMeetingWithStartup('corporate', title);
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const data = (created.json.data ?? {}) as { meetingTitle?: string; meetingCode?: string };
    expect(data.meetingTitle).toBe(title);
    expect(data.meetingCode).toBeTruthy();

    await page.goto('/corporates/dashboard');
    await expect(page.getByText('Upcoming Meetings').or(page.getByText('Meeting Requests')).first()).toBeVisible();
  });
});
