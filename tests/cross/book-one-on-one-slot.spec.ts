/**
 * Journey 6 (SAN-1576): a startup books a slot on a one-on-one event.
 * Owner: Ritu Raj
 * Pass bar: POST /api/v2/events/attend/{eventUuid} returns 2xx with the slot, the agenda and
 * approvalStatus "approved"; the slot then shows Approved; after a reload the upcoming-events
 * API returns the booking on the event.
 *
 * The test creates its own one-on-one event in the admin panel (tomorrow 10:00-11:00 IST,
 * 30-minute slots, startups only, automatic approval, one slot per startup) and deletes it at
 * the end. Events have no test mode, so the event is visible to every member while the test runs.
 * Deleting the event leaves the attendee row and the generated meeting behind (SAN-1613).
 */
import { expect, test } from '@playwright/test';
import { adminAccount, authFile, memberAccount } from '../../config/accounts';
import { CfaAdmin } from '../../fixtures/cfa';
import { createOneOnOneEvent, deleteEvent } from '../../fixtures/events';
import { OneOnOneEventModal } from '../../pages/frontend/OneOnOneEventModal';

test.describe('book a one-on-one slot', { tag: ['@smoke', '@frontend', '@admin', '@startup', '@write'] }, () => {
  test.skip(!memberAccount('startup'), 'QA_STARTUP_EMAIL not set');
  test.skip(!adminAccount('admin'), 'QA_ADMIN_EMAIL / QA_ADMIN_PASSWORD not set: the event is created in the admin panel');
  /* Slot labels are rendered in the browser's time zone; the event is defined in IST. */
  test.use({ storageState: authFile('startup'), timezoneId: 'Asia/Kolkata' });

  test('a startup books the first slot of a one-on-one event', async ({ page }) => {
    test.setTimeout(120_000);
    const admin = new CfaAdmin();
    const event = await createOneOnOneEvent(admin);
    try {
      const agenda = `QA smoke agenda ${Date.now()}`;
      const events = new OneOnOneEventModal(page);
      await page.addInitScript(() => window.localStorage.setItem('skip-first-login-modal', 'true'));

      const upcoming = events.waitForUpcomingEvents();
      await page.goto('/startups/dashboard');
      const listed = ((await (await upcoming).json())?.data ?? []).find((e: { uuid?: string }) => e.uuid === event.uuid);
      expect(listed, 'the new event is in GET /api/v2/events/upcoming').toBeTruthy();

      await events.eventCard(event.title).click();
      await expect(events.modal).toBeVisible();
      const slot = events.slot('10:00 AM - 10:30 AM');
      await slot.getByRole('button', { name: 'Book' }).click();
      await events.agendaInput.fill(agenda);
      const booking = events.waitForBooking(event.uuid);
      await events.submitAgendaButton.click();

      const response = await booking;
      expect(response.ok(), `POST events/attend returned ${response.status()}`).toBe(true);
      expect((await response.json())?.data).toMatchObject({
        date: event.date,
        timeFrom: '10:00',
        timeTo: '10:30',
        agenda,
        responseAction: 'attending',
        approvalStatus: 'approved',
      });
      await expect(slot).toContainText('Approved');
      await expect(events.maxSlotsReachedMessage).toBeVisible();

      const reloaded = events.waitForUpcomingEvents();
      await page.reload();
      const after = ((await (await reloaded).json())?.data ?? []).find((e: { uuid?: string }) => e.uuid === event.uuid);
      expect(after?.checkIfResponseExists, 'the booking on the event after a reload').toMatchObject({
        date: event.date,
        timeFrom: '10:00:00',
        agenda,
        responseAction: 'attending',
      });
    } finally {
      await deleteEvent(admin, event.id);
      await admin.dispose();
    }
  });
});
