import { expect, type Page } from '@playwright/test';
import { adminAccount, type MemberRole, type QARole } from '../../config/accounts';
import { approveMemberProfiles } from '../../fixtures/approveProfile';
import { memberApi, memberSession } from '../../fixtures/memberApi';

const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export { LOGO_PNG };

/** Tomorrow's calendar date (UTC) for meeting booking payloads. */
export function tomorrowDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function skipFirstLoginModal(page: Page) {
  return page.addInitScript(() => window.localStorage.setItem('skip-first-login-modal', 'true'));
}

/**
 * SAN-1608 connection request. Approves both profiles via the admin session first
 * (admin-actions/approve), then POSTs connections/send/request.
 * A 403 "already pending acceptance" counts as ok — re-runs stay idempotent.
 */
export async function sendConnectionRequest(from: MemberRole, to: MemberRole, message: string) {
  expect(adminAccount('admin'), 'QA admin required to approve profiles before connect').toBeTruthy();
  await approveMemberProfiles([from, to]);

  const toProfile = memberSession(to).profile;
  expect(toProfile?.uuid, `${to} session has no user uuid`).toBeTruthy();
  const res = await memberApi(from, 'POST', 'connections/send/request', {
    toUserUUID: toProfile.uuid,
    message,
    documentUrl: '',
  });
  const body = JSON.stringify(res.json);
  const alreadyPending = res.status === 403 && /already pending acceptance/i.test(body);
  return { ...res, ok: res.ok || alreadyPending };
}

/** Book a virtual meeting with the seeded startup (works even when connection is gated). */
export async function bookMeetingWithStartup(from: QARole, title: string) {
  const startup = memberSession('startup').profile;
  expect(startup?.uuid, 'startup session has no user uuid').toBeTruthy();
  const date = tomorrowDate();
  const res = await memberApi(from, 'POST', 'meetings', {
    otherUserUUID: startup.uuid,
    date: `${date}T00:00:00.000Z`,
    timeFrom: '10:00',
    timeTo: '10:30',
    meetingTitle: title,
    meetingDescription: `SAN-1608 regression meeting from ${from}`,
    meetingLocationType: 'virtual',
    meetingInPersonLocation: '',
    meetingToolType: 'inbuilt',
    meetingExternalUrl: '',
    meetingTimeType: 'schedule_later',
    offset: '-330',
    timeZone: 'Asia/Calcutta',
  });
  return res;
}
