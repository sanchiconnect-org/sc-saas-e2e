import { type Locator, type Page } from '@playwright/test';

/**
 * PWA apply page for one program: {FRONTEND_URL}/programs/apply/{code}/{slug}
 * (sc-saas-frontend modules/programs/program-public-apply). Test-mode programs open here
 * by direct URL even though no program list shows them.
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
   * lead modal and OTP, which P3 covers; use it only to look at the form itself.
   */
  async useGuestIdentity(programUuid: string, identity: { email: string; name: string }) {
    await this.page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [`application-${programUuid}`, JSON.stringify(identity)] as const,
    );
  }

  /** The dynamic application form (app-application-program-management-dynamic-form). */
  get applicationForm(): Locator {
    return this.page.locator('app-application-program-management-dynamic-form');
  }

  /** A form field's label/question text inside the application form. */
  formFieldLabel(name: string): Locator {
    return this.applicationForm.getByText(name, { exact: false });
  }
}
