import { expect, type Locator, type Page, type Response } from '@playwright/test';

/**
 * The jury's evaluation page for one round, on the admin panel with the jury's own session:
 * {ADMIN_URL}/jury/round-applications/program/{programId}/round/{roundId}, which redirects to
 * .../{submissionUuid} of the first application in the sidebar. The sidebar (#applicationsList)
 * lists the applications allotted to this jury; "Rate this Application" is a plain form POST
 * (submitAction=addRating) back to the same URL. On a round with a jury NDA the page shows the NDA
 * modal instead until the jury signs.
 */
export class JuryRoundApplicationsPage {
  constructor(private readonly page: Page) {}

  static path(program: { id: string }, roundId: string) {
    return `/jury/round-applications/program/${program.id}/round/${roundId}`;
  }

  /* On a round with a jury NDA the load event never fires (the modal's /jury/nda request stays open). */
  async goto(program: { id: string }, roundId: string) {
    return this.page.goto(JuryRoundApplicationsPage.path(program, roundId), { waitUntil: 'domcontentloaded' });
  }

  /** Sidebar links, one per application the jury can open. */
  get applications(): Locator {
    return this.page.locator('#applicationsList a.list-group-item');
  }

  /** Sidebar link of one application, by its company/applicant name (the sidebar title-cases names). */
  application(name: string | RegExp): Locator {
    const re = typeof name === 'string' ? new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : name;
    return this.applications.filter({ has: this.page.locator('.companyName', { hasText: re }) });
  }

  get ratingForm(): Locator {
    return this.page.locator('form#parsleyForm');
  }

  /** The submission id the open rating form is for. */
  async openSubmissionId(): Promise<string | null> {
    return this.ratingForm.locator('input[name="data[submission_id]"]').getAttribute('value');
  }

  /**
   * Fills the open application's rating form and submits it: `stars` (1-5) on every criterion,
   * an optional comment, and answers for select questions keyed by their field id (question_<n>).
   * Returns the addRating POST response.
   */
  async rate(input: { stars: number; comment?: string; answers?: Record<string, string> }): Promise<Response> {
    const form = this.ratingForm;
    const criteria = await form.locator('input[type="radio"][name^="data[ratings]"]').evaluateAll((els) => [
      ...new Set(els.map((e) => (e as HTMLInputElement).name)),
    ]);
    for (const name of criteria) {
      const radio = form.locator(`input[type="radio"][name="${name}"][value="${input.stars}"]`);
      const id = await radio.getAttribute('id');
      await form.locator(`label[for="${id}"]`).click();
    }
    if (input.comment !== undefined) await form.locator('textarea[name="data[comments]"]').fill(input.comment);
    for (const [questionId, answer] of Object.entries(input.answers ?? {})) {
      /* chosen.js hides the real <select>. */
      await form.locator(`select#${questionId}`).selectOption(answer, { force: true });
    }
    const posted = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/jury/round-applications/'),
    );
    await form.locator('button[type="submit"]').click();
    return posted;
  }

  /** The jury NDA modal (FA-010) a juror gets on a round whose NDA they have not signed. */
  get ndaModal(): Locator {
    return this.page.locator('#juryNdaModal');
  }

  /**
   * Signs the open NDA as the jury does: scroll the PDF to the end (the consent box unlocks only then),
   * tick consent, type the profile name, Accept & sign. Returns the accept POST response; the modal then
   * reloads the round.
   */
  async signNda(fullName: string): Promise<Response> {
    const consent = this.page.locator('#juryNdaConsent');
    await expect(async () => {
      await this.page.locator('#juryNdaViewerBox').evaluate((box) => box.scrollTo(0, box.scrollHeight));
      await expect(consent).toBeEnabled({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await this.page.locator('label[for="juryNdaConsent"]').click();
    await this.page.locator('#juryNdaTypedName').fill(fullName);
    const accepted = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && (r.request().postData() ?? '').split('&').includes('submitAction=accept'),
    );
    await this.page.locator('#juryNdaAccept').click();
    return accepted;
  }
}
