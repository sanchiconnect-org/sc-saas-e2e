/**
 * SAN-1617: visual checks on the most used screens (8 of 10 here; the 2 that need a program are in
 * visual-cfa.spec.ts). Each runs in the visual-desktop and visual-phone projects, so 2 baselines per
 * screen. Owner: Ritu Raj.
 *
 * Read-only: nothing is created or changed. Screens are chosen from the core journeys (no usage data
 * was available on 2026-10-22); swap in Mixpanel's top pages when they're known.
 */
import { test } from '@playwright/test';
import { adminAccount, authFile, memberAccount } from '../../config/accounts';
import { env } from '../../config/env';
import { adminMasks, expectScreen, pwaMasks } from '../../fixtures/visual';

const TAGS = ['@regression', '@visual'];

test.describe('visual: public screens', { tag: TAGS }, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('pwa_install_dismissed', 'true'));
  });

  test('01 login page', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByTestId('login-title').waitFor();
    await expectScreen(page, '01-login', pwaMasks(page));
  });

  test('01 login page: a 1-pixel layout shift is caught (sensitivity guard)', async ({ page }) => {
    /* Done-when of SAN-1617: a deliberate one-pixel layout shift fails the check. Compared with the
       real 01-login baseline, so if this test ever "unexpectedly passes" the tolerance is too loose. */
    /* In update mode a screenshot never fails, it's written: this test would then save the shifted
       page as the 01-login baseline. So it only runs when comparing. */
    test.skip(['all', 'changed'].includes(test.info().config.updateSnapshots), 'not run while baselines are being regenerated');
    test.fail(true, 'the 1px shift must make the 01-login comparison fail');
    await page.goto('/auth/login');
    await page.getByTestId('login-title').waitFor();
    await page.addStyleTag({ content: 'body { transform: translateX(1px); }' });
    await expectScreen(page, '01-login', pwaMasks(page));
  });

  test('02 registration, account type step', async ({ page }) => {
    await page.goto('/auth/register');
    await page.locator('input[type=radio][name=userType]').first().waitFor({ state: 'attached' });
    await expectScreen(page, '02-register-account-type', pwaMasks(page));
  });
});

test.describe('visual: startup screens', { tag: TAGS }, () => {
  test.skip(!memberAccount('startup'), 'QA_STARTUP_EMAIL not set');
  test.use({ storageState: authFile('startup') });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('pwa_install_dismissed', 'true');
      window.localStorage.setItem('skip-first-login-modal', 'true');
    });
  });

  test('03 startup dashboard', async ({ page }) => {
    await page.goto('/startups/dashboard');
    /* Dashboard widgets hold live data (connections, events, programs, notifications). */
    /* Option A (2026-10-23): the whole dashboard body is live data (and it changes overnight), so only
       the app shell is compared: sidebar navigation, header bar and frame. */
    await expectScreen(page, '03-startup-dashboard', [...pwaMasks(page), page.locator('app-startup-dashboard-layout-wrapper')]);
  });

  test('04 startup profile, basic information', async ({ page }) => {
    await page.goto('/startups/edit/startup-information');
    await page.locator('input#companyName').waitFor();
    /* Field values change every run (profile auto-save writes a new company name). */
    await expectScreen(page, '04-startup-profile', [...pwaMasks(page), page.locator('input, textarea, ng-select')]);
  });

  test('05 startup pitch deck page', async ({ page }) => {
    await page.goto('/startups/edit/pitch-deck-documents');
    await page.locator('input#fundraising-pitchRef').waitFor({ state: 'attached' });
    /* The uploaded-file table and the conversion notice depend on the last upload. */
    await expectScreen(page, '05-startup-pitch-deck', [...pwaMasks(page), page.locator('table, .alert')]);
  });

  test('06 call for applications list', async ({ page }) => {
    await page.goto('/call-for-applications');
    /* Program cards are live content; the page frame (tabs, search, header) is what's checked. */
    /* Option A: the program list is live data (cards come and go and shift the layout), so only the
       app shell around it is compared. */
    await expectScreen(page, '06-call-for-applications', [...pwaMasks(page), page.locator('app-call-for-applications')]);
  });
});

test.describe('visual: investor screens', { tag: TAGS }, () => {
  test.skip(!memberAccount('investor'), 'QA_INVESTOR_EMAIL not set');
  test.use({ storageState: authFile('investor') });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('pwa_install_dismissed', 'true'));
  });

  test('08 investor dashboard', async ({ page }) => {
    await page.goto('/investors/dashboard');
    /* Option A: dashboard body masked; the app shell is what's compared. */
    await expectScreen(page, '08-investor-dashboard', [...pwaMasks(page), page.locator('app-investor-dashboard-wrapper')]);
  });
});

test.describe('visual: admin screens', { tag: TAGS }, () => {
  test.skip(!adminAccount('admin'), 'QA_ADMIN_EMAIL / QA_ADMIN_PASSWORD not set');
  test.use({ storageState: authFile('admin'), baseURL: env.adminUrl });

  test('09 admin dashboard', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('heading', { level: 4 }).filter({ hasText: 'Your IP is' }).waitFor();
    /* Dashboard tiles and charts hold live counts. */
    await expectScreen(page, '09-admin-dashboard', [...adminMasks(page), page.locator('.card-body, canvas, svg')]);
  });
});
