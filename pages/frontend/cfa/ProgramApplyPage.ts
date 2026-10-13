import { expect, type Locator, type Page, type Request, type Response } from '@playwright/test';
import { GuestLeadModal } from './GuestLeadModal';

const req = (r: Request | Response): Request => ('request' in r ? r.request() : r);

/** True for the PWA's form save: POST public/forms-management/submission/{formUUID}/submit. */
export function isFormSave(r: Request | Response, formUUID: string): boolean {
  return req(r).method() === 'POST' && req(r).url().includes(`/forms-management/submission/${formUUID}/submit`);
}

/** True for the CFA apply call: POST application-programs-management/{programUUID}/{submissionId}/apply. */
export function isApply(r: Request | Response, programUUID: string): boolean {
  return req(r).method() === 'POST' && new RegExp(`/application-programs-management/${programUUID}/\\d+/apply$`).test(req(r).url());
}

/** The JSON body the PWA posted with a form save (payload of savePublicFormsSubmission). */
export function savePayload(r: Request | Response): Record<string, any> {
  return JSON.parse(req(r).postData() ?? '{}');
}

/**
 * PWA apply page for one program: {FRONTEND_URL}/programs/apply/{code}/{slug}
 * (sc-saas-frontend modules/programs/program-public-apply). Test-mode programs open here
 * by direct URL even though no program list shows them.
 *
 * Flow the page implements: Apply → the GuestLeadModal (name/email, OTP unless bypassed or
 * logged in) → identity saved in localStorage['application-{programUuid}'] → the application
 * form (app-application-program-management-dynamic-form). The form saves a draft as soon as
 * it opens and then every form autoSaveTimer seconds (60 on the dev QA forms, 20 when unset), "Save as Draft" saves now,
 * and "Submit Application" asks "Are you sure?" then saves with submitted=true and calls apply.
 */
export class ProgramApplyPage {
  constructor(private readonly page: Page) {}

  async goto(code: string, slug: string, opts: { autoStatusCheck?: boolean } = {}) {
    await this.page.goto(`/programs/apply/${code}/${slug}${opts.autoStatusCheck ? '?autoStatusCheck=true' : ''}`);
  }

  /** The program title heading at the top of the page (renders once the program has loaded). */
  programTitle(title: string): Locator {
    return this.page.getByRole('heading', { level: 2, name: title, exact: true });
  }

  /**
   * Starts the page as a returning guest applicant: the PWA keeps a guest's identity in
   * localStorage['application-{programUuid}'] (written after the lead modal + OTP) and, when it
   * holds an email, opens straight on the application form. Call before goto(). This skips the
   * lead modal and OTP; use it for applicants that already exist (e.g. CSV-seeded ones).
   */
  async useGuestIdentity(programUuid: string, identity: { email: string; name: string }) {
    await this.page.addInitScript(
      ([key, value]) => {
        /* Only on the first load: later reloads must see what the PWA itself wrote. */
        if (!window.sessionStorage.getItem(`qa-seeded-${key}`)) {
          window.localStorage.setItem(key, value);
          window.sessionStorage.setItem(`qa-seeded-${key}`, '1');
        }
      },
      [`application-${programUuid}`, JSON.stringify(identity)] as const,
    );
  }

  /** The identity the PWA keeps for this program (localStorage['application-{uuid}']), or null. */
  async storedIdentity(programUuid: string): Promise<Record<string, any> | null> {
    const raw = await this.page.evaluate((key) => window.localStorage.getItem(key), `application-${programUuid}`);
    return raw ? JSON.parse(raw) : null;
  }

  /* ----- program information tab ----- */

  /** The Apply button at the top of the page (a second one sits at the bottom). */
  get applyButton(): Locator {
    return this.page.getByRole('button', { name: 'Apply', exact: true }).first();
  }

  /** Clicks Apply and returns the modal it opens. */
  async startApplication(): Promise<GuestLeadModal> {
    await expect(this.applyButton).toBeEnabled({ timeout: 20_000 });
    await this.applyButton.click();
    return new GuestLeadModal(this.page);
  }

  /** The tooltip the disabled Apply button shows on a closed program. */
  get closedTooltip(): Locator {
    return this.page.locator('ngb-tooltip-window').filter({ hasText: 'We are no longer accepting new applications' });
  }

  /** "You are applying as - <name> (<email>) | Application# APP…", shown once an identity is stored. */
  get applyingAs(): Locator {
    return this.page.getByText(/You are applying as -/);
  }

  /* ----- application form ----- */

  /** The dynamic application form (app-application-program-management-dynamic-form). */
  get applicationForm(): Locator {
    return this.page.locator('app-application-program-management-dynamic-form');
  }

  /** A form field's label/question text inside the application form. */
  formFieldLabel(name: string): Locator {
    return this.applicationForm.getByText(name, { exact: false });
  }

  /** A text / text-area / number / email field's input, by field key (the PWA renders id={key}). */
  field(key: string): Locator {
    return this.applicationForm.locator(`[id="${key}"]`);
  }

  /** The hidden file input of a file_upload field, by the field's label. */
  fileInput(fieldName: string): Locator {
    return this.applicationForm.locator('app-form-field').filter({ hasText: fieldName }).locator('input[type="file"]');
  }

  /** The "Uploaded files" table of a file_upload field, by the field's label. */
  uploadedFiles(fieldName: string): Locator {
    return this.applicationForm.locator('app-form-field').filter({ hasText: fieldName }).locator('table');
  }

  /** "This field is required" under the field with this key. */
  requiredMessage(key: string): Locator {
    return this.applicationForm.locator('app-form-field').filter({ has: this.page.locator(`[id="${key}"]`) }).getByText('This field is required');
  }

  get saveDraftButton(): Locator {
    return this.applicationForm.getByRole('button', { name: /Save as Draft/i });
  }

  get submitApplicationButton(): Locator {
    return this.applicationForm.getByRole('button', { name: /Submit Application/i });
  }

  /** "<n> field(s) are not complete yet. Click here to know!" (desktop variant). Clicking it marks the empty fields. */
  get incompleteFieldsBadge(): Locator {
    return this.applicationForm.locator('.d-md-block').filter({ hasText: 'field(s) are not complete yet' });
  }

  /** The confirmation shown once the application is submitted. */
  get submittedConfirmation(): Locator {
    return this.applicationForm.getByText('Your details have been successfully submitted.');
  }

  /**
   * The form's own first save: it creates the draft row as soon as the form opens. Call BEFORE
   * the action that opens the form (the modal's Submit/OTP verify), then pass it to formReady().
   */
  firstSave(formUUID: string): Promise<Response> {
    return this.page.waitForResponse((r) => isFormSave(r, formUUID), { timeout: 45_000 });
  }

  /** Waits for the form to show and its first save to succeed; returns that save. */
  async formReady(firstSave: Promise<Response>): Promise<Response> {
    await expect(this.applicationForm).toBeVisible({ timeout: 30_000 });
    const response = await firstSave;
    expect(response.ok(), `first draft save: HTTP ${response.status()}`).toBe(true);
    return response;
  }

  /** Clicks "Save as Draft" and returns that save (submitted=false). */
  async saveDraft(formUUID: string): Promise<Response> {
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => isFormSave(r, formUUID) && savePayload(r).submitted === false),
      this.saveDraftButton.click(),
    ]);
    return response;
  }

  /**
   * Clicks "Submit Application", confirms the "Are you sure?" dialog, and returns the final save
   * (submitted=true) and the apply call that follows it. The apply route is rate-limited
   * (10/60s per client): on a 429 this waits the window out and repeats the same apply request
   * once (the backend apply is idempotent), the same back-off LoginPage.requestOtp uses.
   */
  async submitApplication(program: { uuid: string; formUUID: string }): Promise<{ save: Response; applyStatus: number; submissionId: string }> {
    await expect(this.submitApplicationButton).toBeEnabled();
    const save = this.page.waitForResponse((r) => isFormSave(r, program.formUUID) && savePayload(r).submitted === true);
    const apply = this.page.waitForResponse((r) => isApply(r, program.uuid));
    await this.submitApplicationButton.click();
    await this.page.locator('.swal2-popup .swal2-confirm').click();

    const saved = await save;
    expect(saved.ok(), `final save: HTTP ${saved.status()}`).toBe(true);
    const applied = await apply;
    const submissionId = /\/(\d+)\/apply$/.exec(applied.url())![1];
    let applyStatus = applied.status();
    if (applyStatus === 429) {
      await this.page.waitForTimeout(61_000);
      applyStatus = (await this.page.request.post(applied.url(), { data: {} })).status();
    }
    return { save: saved, applyStatus, submissionId };
  }

  /* ----- after a rejection (SAN-352/353) ----- */

  get rejectedNotice(): Locator {
    return this.page.getByRole('heading', { name: 'Your previous application was rejected' });
  }

  get reapplyNowButton(): Locator {
    return this.page.getByRole('button', { name: 'Reapply Now' });
  }
}
