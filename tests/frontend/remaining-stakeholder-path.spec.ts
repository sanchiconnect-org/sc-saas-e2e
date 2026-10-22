/**
 * SAN-1612 tool half: partner, service provider and individual journeys written in Cursor.
 * Owner: Ritu Raj
 * Pass bar: meeting create returns 201 with the title sent; Call for Applications returns 2xx;
 * the service-provider public profile opens from the dashboard.
 *
 * The tool output is Playwright TypeScript in this repo. No hosted runner.
 */
import { expect, test } from '@playwright/test';
import { memberAccount } from '../../config/accounts';
import { asRole } from '../../fixtures/auth';
import { CallForApplicationsPage } from '../../pages/frontend/cfa/CallForApplicationsPage';
import { ProfileEditPage } from '../../pages/frontend/ProfileEditPage';
import { bookMeetingWithStartup, skipFirstLoginModal } from './stakeholder-path-helpers';

const meeting = (role: 'partner' | 'service_provider' | 'individual', dashboard: string) => {
  test.describe(`${role} meeting`, { tag: ['@regression', '@frontend', `@${role}`, '@write'] }, () => {
    test.skip(!memberAccount(role), `QA_${role.toUpperCase()}_EMAIL not set`);
    test.skip(!memberAccount('startup'), 'QA_STARTUP_EMAIL not set');
    asRole(role);

    test(`books a virtual meeting with the seeded startup`, async ({ page }) => {
      await skipFirstLoginModal(page);
      const title = `QA SAN-1612 ${role} meeting ${Date.now()}`;
      const created = await bookMeetingWithStartup(role, title);
      expect(created.status, JSON.stringify(created.json)).toBe(201);
      const data = (created.json.data ?? {}) as { meetingTitle?: string; meetingCode?: string };
      expect(data.meetingTitle).toBe(title);
      expect(data.meetingCode).toBeTruthy();
      await page.goto(dashboard);
      await expect(page).toHaveURL(new RegExp(dashboard.replace(/\//g, '\\/')));
    });
  });
};

meeting('partner', '/partners/dashboard');
meeting('service_provider', '/service-provider/dashboard');
meeting('individual', '/individuals/dashboard');

test.describe('partner call for applications', { tag: ['@regression', '@frontend', '@partner'] }, () => {
  test.skip(!memberAccount('partner'), 'QA_PARTNER_EMAIL not set');
  asRole('partner');

  test('Call for Applications list loads', async ({ page }) => {
    await skipFirstLoginModal(page);
    const cfa = new CallForApplicationsPage(page);
    const list = await cfa.goto();
    expect(list.ok(), `application-programs-management → ${list.status()}`).toBe(true);
    await expect(page).toHaveURL(/\/call-for-applications/);
    await expect(cfa.sectionButton('Active')).toBeVisible();
  });
});

test.describe('service provider public profile', { tag: ['@regression', '@frontend', '@service_provider'] }, () => {
  test.skip(!memberAccount('service_provider'), 'QA_SERVICE_PROVIDER_EMAIL not set');
  asRole('service_provider');

  test('dashboard link opens the service provider public profile', async ({ page }) => {
    await skipFirstLoginModal(page);
    await page.goto('/service-provider/dashboard');
    await new ProfileEditPage(page).openPublicProfile('/service-provider/profile/');
  });
});
