/**
 * Investor regression path (SAN-1608): profile completion, connection request, meeting booking.
 * Owner: Ritu Raj
 */
import { expect, test } from '@playwright/test';
import { adminAccount, memberAccount } from '../../config/accounts';
import { asRole } from '../../fixtures/auth';
import { InvestorProfilePage } from '../../pages/frontend/InvestorProfilePage';
import {
  bookMeetingWithStartup,
  sendConnectionRequest,
  skipFirstLoginModal,
} from './stakeholder-path-helpers';

const TAGS = ['@regression', '@frontend', '@investor', '@write'] as const;

test.describe('investor path: complete profile', { tag: [...TAGS] }, () => {
  test.skip(!memberAccount('investor'), 'QA_INVESTOR_EMAIL not set');
  asRole('investor');

  test('investment instruments, preferences and stages can be saved', async ({ page }) => {
    await skipFirstLoginModal(page);
    const profile = new InvestorProfilePage(page);
    await profile.goto();

    const tat = String(50 + (Date.now() % 40));
    const save = profile.waitForSave();
    await profile.ensureBasics(tat);

    /* Auto-save is a ~20s dirty tick; Next Step also PATCHes when enabled. */
    const next = page.getByRole('button', { name: /next step/i });
    if (await next.isEnabled()) await next.click();
    const response = await save;
    expect(response.ok(), `investor save returned ${response.status()}`).toBe(true);

    await expect(profile.turnaroundTime).toHaveValue(tat);
    await page.goto('/investors/dashboard');
    await expect(page).toHaveURL(/\/investors\/dashboard/);
  });
});

test.describe('investor path: connection request', { tag: [...TAGS] }, () => {
  test.skip(!memberAccount('investor'), 'QA_INVESTOR_EMAIL not set');
  test.skip(!memberAccount('startup'), 'QA_STARTUP_EMAIL not set');
  test.skip(!adminAccount('admin'), 'QA admin required to approve profiles before connect');
  asRole('investor');

  test('sends a connection request to the seeded startup when profiles are approved', async ({ page }) => {
    test.setTimeout(120_000);
    await skipFirstLoginModal(page);
    await page.goto('/connections');
    await expect(page).toHaveURL(/\/connections/);

    const res = await sendConnectionRequest('investor', 'startup', `QA SAN-1608 investor connect ${Date.now()}`);
    expect(res.ok, `connections/send/request → ${res.status} ${JSON.stringify(res.json)}`).toBe(true);
  });
});

test.describe('investor path: meeting booking', { tag: [...TAGS] }, () => {
  test.skip(!memberAccount('investor'), 'QA_INVESTOR_EMAIL not set');
  test.skip(!memberAccount('startup'), 'QA_STARTUP_EMAIL not set');
  asRole('investor');

  test('books a virtual meeting with the seeded startup', async ({ page }) => {
    await skipFirstLoginModal(page);
    const title = `QA SAN-1608 investor meeting ${Date.now()}`;
    const created = await bookMeetingWithStartup('investor', title);
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const data = (created.json.data ?? {}) as { meetingTitle?: string; meetingCode?: string };
    expect(data.meetingTitle).toBe(title);
    expect(data.meetingCode).toBeTruthy();

    await page.goto('/investors/dashboard');
    await expect(page.getByText('Upcoming Meetings').or(page.getByText('Meeting Requests')).first()).toBeVisible();
  });
});
