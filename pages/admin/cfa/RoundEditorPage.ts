import { type Locator, type Page } from '@playwright/test';

/**
 * Round editor: {ADMIN_URL}/application_management/edit_program_round/{roundId}?section=<section>
 * (sc-saas-admin modules/application_management/edit_program_round.php). In the admin UI it is
 * loaded inside the #loadIframeBoxEditRound modal; tests open it directly. The "settings"
 * section is a plain HTML form posting submitAction=editRound; the page re-renders with a
 * success or error alert.
 */
export class RoundEditorPage {
  constructor(private readonly page: Page) {}

  async goto(roundId: string, section = 'settings') {
    await this.page.goto(`/application_management/edit_program_round/${roundId}?section=${section}`);
  }

  get roundNameInput(): Locator {
    return this.page.locator('input[name="data[round_name]"]');
  }

  /** "Disable auto communication status updates to the applicant?" Yes = silent_transfer 1. */
  silentTransferRadio(value: 'yes' | 'no'): Locator {
    return this.page.locator(`input[name="data[silent_transfer]"]#${value}`);
  }

  async chooseSilentTransfer(value: 'yes' | 'no') {
    await this.page.locator(`label[for="${value}"]`).click();
  }

  async submit() {
    await Promise.all([
      this.page.waitForResponse((r) => r.request().method() === 'POST' && /edit_program_round\/\d+/.test(r.url())),
      this.page.locator('#parsleyForm button[type="submit"]').click(),
    ]);
  }

  get successAlert(): Locator {
    return this.page.locator('.alert-success');
  }

  get errorAlert(): Locator {
    return this.page.locator('.alert-danger');
  }
}
