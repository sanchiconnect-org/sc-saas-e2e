import { createHash } from 'crypto';
import { env } from '../config/env';

/**
 * Thin client for the sc-saas-backend public endpoints the seed needs.
 * Every response is wrapped by the backend's TransformInterceptor as
 * { status_code, message, data }.
 */

interface ApiEnvelope<T> {
  status_code: number;
  message: string;
  data: T;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: unknown,
  ) {
    super(`${path} → HTTP ${status}: ${JSON.stringify(body)}`);
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiEnvelope<T>> {
  const frontendHost = new URL(env.frontendUrl).hostname;
  const res = await fetch(`${env.apiUrl}/api/v1/${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      /* The frontend sends this on every backend call; mirror it so the request looks like the QA tenant's PWA. */
      'x-hostname': frontendHost,
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
  if (!res.ok) throw new ApiError(res.status, path, json);
  return json as ApiEnvelope<T>;
}

/** GET public/auth/verify/email/:email → data.isExist */
export async function emailExists(email: string): Promise<boolean> {
  const res = await call<{ isExist: boolean }>('GET', `public/auth/verify/email/${encodeURIComponent(email)}`);
  return !!res.data?.isExist;
}

/**
 * Send + verify an email OTP and return the verification id that `register` needs
 * as `emailVerificationId`. Works without an inbox only because the QA backend
 * accepts the fixed QA_OTP for seeded accounts.
 */
export async function verifiedEmailId(email: string, name: string, otp: string): Promise<string> {
  await call('POST', 'public/otp_verifications/send', { type: 'email', emailAddress: email, name });
  const res = await call<{ id: string }>('POST', 'public/otp_verifications/verify', {
    type: 'email',
    emailAddress: email,
    /* The backend compares against the stored md5 hash without re-hashing, so the
       client sends md5(code) — exactly what the PWA does (sc-saas-frontend auth.service.ts). */
    code: createHash('md5').update(otp).digest('hex'),
  });
  if (!res.data?.id) throw new Error(`OTP verify for ${email} returned no verification id`);
  return res.data.id;
}

/** POST public/auth/register (RegisterUserDto) */
export async function register(payload: Record<string, unknown>): Promise<void> {
  await call('POST', 'public/auth/register', payload);
}
