import { type Locator, type Page, type Response } from '@playwright/test';

/**
 * A one-on-one event (eventType one_to_one) as a member books it: the event card under Upcoming
 * Events on the dashboard opens app-event-details-one-on-one-modal, which lists the slots under
 * "Book your slot". Book → SweetAlert "Agenda" textarea → Submit posts
 * POST /api/v2/events/attend/{eventUuid}.
 */
export class OneOnOneEventModal {
  constructor(private readonly page: Page) {}

  /** Resolves with GET /api/v2/events/upcoming, which the dashboard loads on every visit. */
  waitForUpcomingEvents(): Promise<Response> {
    return this.page.waitForResponse((r) => r.request().method() === 'GET' && /\/api\/v2\/events\/upcoming(\?|$)/.test(r.url()));
  }

  /** The event's entry in the dashboard's event lists. */
  eventCard(title: string): Locator {
    return this.page.getByText(title, { exact: true }).first();
  }

  get modal(): Locator {
    return this.page.locator('app-event-details-one-on-one-modal');
  }

  /** One row under "Book your slot", by its label as shown, e.g. "10:00 AM - 10:30 AM". */
  slot(label: string): Locator {
    return this.modal.locator('.max-h-slots > div', { hasText: label });
  }

  get agendaInput(): Locator {
    return this.page.getByRole('textbox', { name: 'Share the topic you would like to discuss' });
  }

  get submitAgendaButton(): Locator {
    return this.page.locator('.swal2-popup').getByRole('button', { name: 'Submit' });
  }

  get maxSlotsReachedMessage(): Locator {
    return this.modal.getByText('You have reached the maximum number of slots you can book for this event.');
  }

  waitForBooking(eventUuid: string): Promise<Response> {
    return this.page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/api/v2/events/attend/${eventUuid}`));
  }
}
