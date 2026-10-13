import { expect, type Locator, type Page, type Response } from '@playwright/test';

/** The application-status record the apply page loads for a stored identity (check_application_status/{email}/details). */
export interface ApplicationStatusDetails {
  /** application_program_submission_rounds row of the application */
  id: number;
  submissionId: number;
  applicationNumber: string | null;
  applicationStatus: string;
  submissionStatus: string;
  currentRoundId: number | null;
  currentRound?: { id: number; roundName: string } | null;
  isRejected: boolean;
  allowReapplication?: boolean;
  canReapplyNow?: boolean;
  [key: string]: unknown;
}

/**
 * The "Application Status" view of the PWA apply page: what an applicant sees when they come
 * back to /programs/apply/{code}/{slug} (a guest with their identity in localStorage, or a
 * member, for whom ?autoStatusCheck=true writes it from the profile).
 *
 * The page loads POST application-programs-management/{programUUID}/check_application_status/{email}/details
 * and renders from it. The round tabs ("Application Form" + the current round) render only when
 * the tenant flag application_management_round_status_updates is on.
 */
export class ApplicationStatusPage {
  constructor(private readonly page: Page) {}

  /** Waits for the status details response of the next page load / reload. Start waiting before goto(). */
  waitForDetails(programUuid: string): Promise<Response> {
    return this.page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        r.url().includes(`/application-programs-management/${programUuid}/check_application_status/`) &&
        r.url().endsWith('/details'),
      { timeout: 30_000 },
    );
  }

  /** The details body of a status response (the backend wraps it in { data }). */
  static async details(response: Response): Promise<ApplicationStatusDetails> {
    expect(response.ok(), `status details: HTTP ${response.status()}`).toBe(true);
    const body = await response.json();
    return (body?.data ?? body) as ApplicationStatusDetails;
  }

  /** The "Application Status" nav item next to "Program Information". */
  get statusTab(): Locator {
    return this.page.locator('.menu-item').filter({ hasText: 'Application Status' });
  }

  /** A round tab of the status view (rendered only with application_management_round_status_updates on). */
  roundTab(roundName: string): Locator {
    return this.page.locator('.wrapper-tabs .menu-item').filter({ hasText: roundName });
  }

  /** "Application# APP…" in the "You are applying as" line. */
  applicationNumber(number: string): Locator {
    return this.page.getByText(`Application# ${number}`);
  }
}
