import { CfaAdmin, newCfaRunId } from './cfa';

/**
 * Admin-side helpers for one-on-one ("1:1 Meeting", event_type one_to_one) events. Every write
 * is the same jQuery POST the admin UI makes (sc-saas-admin modules/events), sent through the
 * CfaAdmin submitAction client on the saved admin session:
 *   createEvent, deleteEvent      /events/list
 *   updateEvent (multipart)       /events/edit/info/{uuid}/{slug}
 *   makeEventLive                 /events/edit/publish/{uuid}
 *
 * Events have no test mode: a published event is listed under Upcoming Events for every member
 * of the tenant until it is deleted, so keep it live only for the length of one test.
 */

export interface OneOnOneEvent {
  /** events.id (admin) */
  id: string;
  uuid: string;
  title: string;
  /** yyyy-mm-dd, IST */
  date: string;
  /** 24h HH:mm, IST */
  timeFrom: string;
  timeTo: string;
}

export function oneOnOneEventTitle(runId = newCfaRunId()): string {
  return `[QA] 1:1 run-${runId}`;
}

/** Tomorrow's date in IST, so every slot is in the future whatever time the run starts. */
export function tomorrowIst(now = new Date()): string {
  return new Date(now.getTime() + 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/**
 * Creates and publishes a one-on-one event: tomorrow 10:00-11:00 IST, online, 30-minute slots,
 * bookable by startups only, automatic approval, one slot per startup. Deletes it again if any
 * step fails.
 */
export async function createOneOnOneEvent(admin: CfaAdmin, title = oneOnOneEventTitle()): Promise<OneOnOneEvent> {
  const created = await admin.submitAction('/events/list', 'createEvent', { eventTitle: title });
  const editPath = new URL(String(created.editUrl)).pathname;
  const uuid = /\/events\/edit\/info\/([0-9a-f-]{36})\//.exec(editPath)?.[1];
  if (!uuid) throw new Error(`createEvent: no event uuid in editUrl ${created.editUrl}`);
  const id = /eventId:\s*(\d+)/.exec(await admin.html(editPath))?.[1];
  if (!id) throw new Error(`event ${uuid}: no eventId on the edit page`);

  const event: OneOnOneEvent = { id, uuid, title, date: tomorrowIst(), timeFrom: '10:00', timeTo: '11:00' };
  try {
    await admin.submitMultipart(editPath, 'updateEvent', {
      is_tax_included: '0',
      tax_profile_id: 'null',
      is_mobile_number_required: '0',
      is_organization_required: '0',
      is_designation_required: '0',
      name: '',
      amount: '',
      event_type: 'one_to_one',
      delivery_mode: 'online',
      event_title: title,
      event_description: 'Automated E2E one-on-one event. Safe to delete.',
      event_registration_url: '',
      location: '',
      time_slot_difference_in_mins: '30',
      event_duration_type: 'single_day',
      time_slot_booking_visibility: 'public',
      time_slot_booking_allowed_usertypes: JSON.stringify(['startup']),
      time_slot_booking_allowed_user_statuses: JSON.stringify([]),
      day_time_starts_from: '10:00 am',
      approval_mode: 'automatic',
      application_cap: '',
      max_slots_per_startup: '1',
      cc_emails: '',
      dates: JSON.stringify([{ date: event.date, time_from: event.timeFrom, time_to: event.timeTo, breaks: [] }]),
      event_questions: JSON.stringify([]),
    });
    await admin.submitAction(`/events/edit/publish/${uuid}`, 'makeEventLive', { eventId: id });
    return event;
  } catch (e) {
    await deleteEvent(admin, id).catch(() => undefined);
    throw e;
  }
}

/** deleteEvent (/events/list). Works on a published event that already has bookings. */
export async function deleteEvent(admin: CfaAdmin, eventId: string) {
  return admin.submitAction('/events/list', 'deleteEvent', { eventId });
}
