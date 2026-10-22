import * as fs from 'fs';
import { env } from '../config/env';
import { type QARole, authFile } from '../config/accounts';

/** Read the saved PWA session for a role (from setup-frontend). */
export function memberSession(role: QARole) {
  const state = JSON.parse(fs.readFileSync(authFile(role), 'utf8'));
  const token = state.cookies.find((c: { name: string }) => c.name === 'accessToken')?.value as
    | string
    | undefined;
  if (!token) throw new Error(`No accessToken in ${authFile(role)}`);
  const origin = state.origins.find((o: { origin: string }) =>
    o.origin.includes(new URL(env.frontendUrl).hostname),
  );
  const profileRaw = origin?.localStorage?.find((x: { name: string }) => x.name === 'profile')?.value;
  const profile = profileRaw ? JSON.parse(profileRaw) : null;
  return { token, profile };
}

/** Authenticated call to the QA tenant API as a seeded member. */
export async function memberApi(
  role: QARole,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
) {
  const { token } = memberSession(role);
  const res = await fetch(`${env.apiUrl}/api/v1/${path.replace(/^\//, '')}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-hostname': new URL(env.frontendUrl).hostname,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, ok: res.ok, json: json as Record<string, unknown> };
}
