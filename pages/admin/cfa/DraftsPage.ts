import { type Locator, type Page } from '@playwright/test';
import { type AdminJson } from '../../../fixtures/cfa';
import { confirmSwal, waitForSubmitAction } from './adminAjax';

/**
 * Draft (not yet submitted) applications of a program:
 * {ADMIN_URL}/application_management/draft_applications/{programId}/{adminSlug}
 * (sc-saas-admin modules/application_management/draft_applications.php). CSV imports land here.
 */
export class DraftsPage {
  constructor(private readonly page: Page) {}

  async goto(program: { id: string; adminSlug: string }) {
    await this.page.goto(`/application_management/draft_applications/${program.id}/${program.adminSlug}`);
  }

  /** The row of one draft (forms_submissions.id). */
  row(applicationId: string): Locator {
    return this.page.locator('tr#applicationsList', { has: this.page.locator(`input.checkrecord[applicationid="${applicationId}"]`) });
  }

  /** Row action "Move to Submitted" → confirm (moveToSubmitted). */
  async moveToSubmitted(applicationId: string): Promise<AdminJson> {
    await this.row(applicationId).locator('.singleApplicationMoveBtn').click();
    const moved = waitForSubmitAction(this.page, 'moveToSubmitted');
    await confirmSwal(this.page);
    return moved;
  }

  /** Row action "Delete Record" → confirm (deleteApplication). */
  async deleteApplication(applicationId: string): Promise<AdminJson> {
    await this.row(applicationId).locator('.deleteApplicationBtn').click();
    const deleted = waitForSubmitAction(this.page, 'deleteApplication');
    await confirmSwal(this.page);
    return deleted;
  }
}
