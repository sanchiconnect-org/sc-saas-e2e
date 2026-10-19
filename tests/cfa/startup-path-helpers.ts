/**
 * Shared steps of the startup regression path (SAN-1606), journeys 3 to 5: the seeded startup
 * applies to a throwaway program on its saved session. One account holds one live application
 * per program, so every journey creates its own program and deletes it afterwards.
 */
import { type Page } from '@playwright/test';
import { memberAccount } from '../../config/accounts';
import { createCfaProgram, expect, test, type CfaAdmin, type CfaProgram } from '../../fixtures/cfa';
import { ProgramApplyPage } from '../../pages/frontend/cfa/ProgramApplyPage';

export const startup = memberAccount('startup');

export const SUCCESS_EMAIL = 'application-program-management-success-email';
export const REJECT_EMAIL = 'application-program-management-reject-email';

/** A throwaway test-mode program with `rounds` rounds and the template form, recorded for cfa-teardown. */
export function createPathProgram(admin: CfaAdmin, runId: string, label: string, rounds = 1): Promise<CfaProgram> {
  return createCfaProgram(admin, {
    runId,
    label: `path-${label}-${Math.random().toString(36).slice(2, 8)}`,
    rounds,
    ratingCriteriaOnLastRound: false,
  });
}

/**
 * The seeded startup applies through the PWA: Apply → the pre-filled modal (no OTP for a member)
 * → the form → Submit Application. Skips when Apply is disabled for the startup
 * (approved_startups_can_apply_on_programs on and its profile not approved).
 * Returns the submission id the apply call carried (forms_submissions.id).
 */
export async function applyAsStartup(page: Page, program: CfaProgram): Promise<{ submissionId: string }> {
  const apply = new ProgramApplyPage(page);
  await apply.goto(program.code, program.slug);
  await expect(apply.programTitle(program.title)).toBeVisible({ timeout: 20_000 });
  test.skip(
    !(await apply.applyButton.isEnabled()),
    'Apply is disabled for the seeded startup (approved_startups_can_apply_on_programs is on and its profile is not approved)',
  );

  const modal = await apply.startApplication();
  const firstSave = apply.firstSave(program.formUUID);
  await modal.submitWithoutOtp();
  await apply.formReady(firstSave);

  const { applyStatus, submissionId } = await apply.submitApplication(program);
  expect(applyStatus, 'apply').toBeLessThan(300);
  await expect(apply.submittedConfirmation).toBeVisible();
  return { submissionId };
}
