/**
 * SAN-1612 hand half: profile screens for roles that had no edit-page journey.
 * Owner: Ritu Raj
 * Pass bar: each edit screen shows the field observed on development, and the partner
 * public profile opens from the dashboard.
 *
 * Authored from a DOM pass of the logged-in PWA (the same facts Playwright codegen records).
 */
import { test } from '@playwright/test';
import { memberAccount } from '../../config/accounts';
import { asRole } from '../../fixtures/auth';
import { ProfileEditPage } from '../../pages/frontend/ProfileEditPage';
import { skipFirstLoginModal } from './stakeholder-path-helpers';

test.describe('partner account settings', { tag: ['@regression', '@frontend', '@partner'] }, () => {
  test.skip(!memberAccount('partner'), 'QA_PARTNER_EMAIL not set');
  asRole('partner');

  test('account settings shows designation', async ({ page }) => {
    await skipFirstLoginModal(page);
    await new ProfileEditPage(page).expectField('/account/edit/profile', 'input#designation');
  });
});

test.describe('service provider profile', { tag: ['@regression', '@frontend', '@service_provider'] }, () => {
  test.skip(!memberAccount('service_provider'), 'QA_SERVICE_PROVIDER_EMAIL not set');
  asRole('service_provider');

  test('edit profile shows the website field', async ({ page }) => {
    await skipFirstLoginModal(page);
    await new ProfileEditPage(page).expectField(
      '/service-provider/edit/service-provider-information',
      'input#website',
    );
  });
});

test.describe('individual profile', { tag: ['@regression', '@frontend', '@individual'] }, () => {
  test.skip(!memberAccount('individual'), 'QA_INDIVIDUAL_EMAIL not set');
  asRole('individual');

  test('edit profile shows the short description', async ({ page }) => {
    await skipFirstLoginModal(page);
    await new ProfileEditPage(page).expectField(
      '/individuals/edit/individual-information',
      'textarea[formcontrolname=shortDescription]',
    );
  });
});

test.describe('program office profile', { tag: ['@regression', '@frontend', '@program_office'] }, () => {
  test.skip(!memberAccount('program_office'), 'QA_PROGRAM_OFFICE_EMAIL not set');
  asRole('program_office');

  test('edit profile shows department', async ({ page }) => {
    await skipFirstLoginModal(page);
    await new ProfileEditPage(page).expectField(
      '/program-office-members/edit/program-office-member-information',
      'input#department',
    );
  });
});

test.describe('partner public profile', { tag: ['@regression', '@frontend', '@partner'] }, () => {
  test.skip(!memberAccount('partner'), 'QA_PARTNER_EMAIL not set');
  asRole('partner');

  test('dashboard link opens the partner public profile', async ({ page }) => {
    await skipFirstLoginModal(page);
    await page.goto('/partners/dashboard');
    await new ProfileEditPage(page).openPublicProfile('/partners/');
  });
});
