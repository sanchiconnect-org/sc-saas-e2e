import { type FrameLocator, type Locator, type Page, type Response } from '@playwright/test';
import { parseAdminJson, type AdminJson } from '../../../fixtures/cfa';
import { confirmSwal } from './adminAjax';

/**
 * Table view of a program's submissions:
 * {ADMIN_URL}/application_management/submission-application-management-tableview/{programId}/{adminSlug}
 * (sc-saas-admin modules/application_management). Moves go through this view, not the kanban,
 * whose jQuery-UI drag is flaky (FT-006).
 */
export class SubmissionsTablePage {
  constructor(private readonly page: Page) {}

  async goto(program: { id: string; adminSlug: string }) {
    await this.page.goto(`/application_management/submission-application-management-tableview/${program.id}/${program.adminSlug}`);
  }

  /** The table row of one submission (forms_submissions.id). */
  row(submissionId: string): Locator {
    return this.page.locator('tbody tr', { has: this.page.locator(`input.checkrecord[submissionid="${submissionId}"]`) });
  }

  /** The application number (APP0xxxx) the row's detail link carries. */
  async applicationNumber(submissionId: string): Promise<string | null> {
    return this.row(submissionId).locator('a.openApplicationDetail').getAttribute('application_number');
  }

  /** Opens the application detail side panel from the applicant's name in the row. */
  async openDetail(submissionId: string) {
    await this.row(submissionId).locator('a.openApplicationDetail').click();
  }

  /** "Application Detail … (#APP0xxxx)" at the top of the side panel. */
  get detailTitle(): Locator {
    return this.page.locator('#offSectionCanvasBox h5#applicationNameTitle');
  }

  /** The application-submission-detail page loaded inside the side panel. */
  get detailFrame(): FrameLocator {
    return this.page.frameLocator('#offSectionCanvasBox iframe#loadIframeBox');
  }

  async closeDetail() {
    await this.page.locator('#closeCustomizeFieldsOffCanvas').click();
  }

  /**
   * Row action Move to Round → <round> → SweetAlert "Yes", then waits for the
   * moveApplicationToNextRound POST. On success the page reloads at once, which can make the
   * response body unreadable: `json` is then undefined and this waits for the reload. On
   * failure the page stays put (error toast only) and `json` carries the errorMessage.
   * HTTP is 200 either way, so read the result back as well.
   */
  async moveToRound(submissionId: string, roundId: string): Promise<{ response: Response; json?: AdminJson }> {
    const row = this.row(submissionId);
    await row.getByRole('button', { name: 'Move to Round' }).click();
    await row.locator(`a.acceptAndMoveToNextRound[nextroundid="${roundId}"]`).click();
    const moved = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && (r.request().postData() ?? '').split('&').includes('submitAction=moveApplicationToNextRound'),
    );
    const reloaded = this.page.waitForEvent('domcontentloaded', { timeout: 30_000 });
    await confirmSwal(this.page);
    const response = await moved;
    let json: AdminJson | undefined;
    try {
      json = parseAdminJson('moveApplicationToNextRound', response.status(), await response.text());
    } catch {
      json = undefined;
    }
    if (response.ok() && (!json || json.success === true)) await reloaded;
    return { response, json };
  }

  /**
   * Bulk Move: ticks the rows, toolbar "Move to" → <round> → "Move Application(s)" confirm. The
   * page sends ONE moveApplicationToNextRound carrying every ticked id (applicationId[]).
   * Returns the response and the ids the request carried.
   */
  async bulkMoveToRound(submissionIds: string[], roundId: string): Promise<{ response: Response; sentIds: string[]; json?: AdminJson }> {
    for (const id of submissionIds) await this.page.locator(`input.checkrecord[submissionid="${id}"]`).check();
    const toolbar = this.page.locator('#bulkActionButtons');
    await toolbar.locator('button.btn-success[data-toggle="dropdown"]').click();
    await toolbar.locator(`a.bulkAccept[nextroundid="${roundId}"]`).click();
    const moved = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && (r.request().postData() ?? '').split('&').includes('submitAction=moveApplicationToNextRound'),
    );
    await confirmSwal(this.page);
    const response = await moved;
    /* jQuery encodes the id array as applicationId[]=…&applicationId[]=… */
    const sentIds = new URLSearchParams(response.request().postData() ?? '').getAll('applicationId[]');
    let json: AdminJson | undefined;
    try {
      json = parseAdminJson('moveApplicationToNextRound', response.status(), await response.text());
    } catch {
      json = undefined;
    }
    return { response, sentIds, json };
  }

  /**
   * More Actions → Import Applications → the SweetAlert file input → Upload (import_applications_csv).
   * Imported rows land on the drafts page. On success the page opens the drafts page in a new tab.
   */
  async importCsv(file: { name: string; buffer: Buffer }): Promise<AdminJson> {
    await this.page.getByRole('button', { name: 'More Actions' }).click();
    await this.page.locator('#importcsv').click();
    await this.page.locator('.swal2-popup input.swal2-file').setInputFiles({ name: file.name, mimeType: 'text/csv', buffer: file.buffer });
    /* A multipart body with a file has no readable postData, so match the upload URL (#importcsv postUrl). */
    const imported = this.page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/import_applications_csv'));
    await confirmSwal(this.page);
    const response = await imported;
    return parseAdminJson('import_applications_csv', response.status(), await response.text());
  }
}
