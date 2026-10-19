import { E2E_ENV, env, type E2EEnv } from './env';

/**
 * Frozen public cockpit contracts for SAN-1609 (black-box counterpart to SAN-1591).
 * Shape notes from tenants `contracts/tenant-verification.schema.json` / SAN-1591:
 *   verify_tenant data: 9 top-level keys, users 18, features 216
 *   tenant-settings data: 5 top-level keys
 * resolve-domain uses the same verifyTenant() builder (+ optional partnerAbbreviation).
 */

const COCKPIT_BY_ENV: Record<E2EEnv, string> = {
  development: 'https://api.tenants.sanchidev.in',
  staging: 'https://api.tenants.sanchiconnect.com',
  production: 'https://api.tenants.sanchiconnect.com',
};

/** Override with COCKPIT_URL when set; otherwise the cockpit for E2E_ENV. */
export function cockpitUrl(): string {
  return env.cockpitUrl || COCKPIT_BY_ENV[E2E_ENV];
}

export function qaHostname(): string {
  return new URL(env.frontendUrl).hostname;
}

export const VERIFY_TENANT_DATA_KEYS = [
  'domain',
  'customDomain',
  'apiUrl',
  'active',
  'subscription_active',
  'subscription_active_message',
  'users',
  'features',
  'maintenance_mode',
] as const;

export const TENANT_SETTINGS_DATA_KEYS = [
  'features',
  'settings',
  'subscription_active',
  'subscription_active_message',
  'maintenance_mode',
] as const;

/** Stakeholder / registration toggles on verify_tenant.data.users (frozen count: 18). */
export const VERIFY_TENANT_USER_KEYS = [
  'startups',
  'investors',
  'mentors',
  'corporates',
  'service_providers',
  'government',
  'program_offices',
  'individuals',
  'partners',
  'partner_registration',
  'job_seekers',
  'job_seekers_registration',
  'program_offices_registration',
  'individual_registration',
  'service_providers_registration',
  'startups_registration',
  'investors_registration',
  'corporates_registration',
] as const;

/** Non-secret settings keys every consumer reads. */
export const TENANT_SETTINGS_REQUIRED_KEYS = [
  'domain',
  'customDomain',
  'apiUrl',
  'adminUrl',
  'admin_domain',
] as const;

/**
 * Flag columns the suite and login path depend on. Must exist on verify_tenant.features
 * (boolean / 0 / 1). Presence matters more than the QA tenant's current on/off value.
 */
export const REQUIRED_FLAG_COLUMNS = [
  'email_otp_verification',
  'mobile_otp_verification',
  'application_management',
  'online_meetings',
  'events',
  'connections',
  'ai_analyzer_enabled',
] as const;

/** Keys that must never carry a non-empty value on a public response (SAN-1591 secretsToRemove + obvious secrets). */
export const PUBLIC_SECRET_KEYS = [
  'azure_client_secret',
  'analyzer_api_token',
  'email_password_ses',
  'factacy_api_key',
] as const;

const SECRET_KEY_RE = /password|secret|api[_-]?key|private[_-]?key|(^|_)token$/i;

export type CockpitEnvelope = {
  status_code?: number;
  message?: string;
  data?: Record<string, unknown>;
};

export async function fetchCockpitJson(path: string): Promise<{ status: number; body: CockpitEnvelope }> {
  const origin = env.frontendUrl;
  const res = await fetch(`${cockpitUrl()}${path}`, {
    headers: {
      accept: 'application/json',
      origin,
      referer: `${origin}/`,
    },
  });
  const text = await res.text();
  let body: CockpitEnvelope;
  try {
    body = JSON.parse(text) as CockpitEnvelope;
  } catch {
    throw new Error(`${path}: expected JSON, got HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return { status: res.status, body };
}

export function sortedKeys(obj: Record<string, unknown> | undefined): string[] {
  return Object.keys(obj ?? {}).sort();
}

/** Paths of keys that look secret and hold a non-empty value. */
export function secretValuesPresent(root: unknown, prefix = ''): string[] {
  if (!root || typeof root !== 'object') return [];
  const found: string[] = [];
  for (const [key, value] of Object.entries(root as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const looksSecret = SECRET_KEY_RE.test(key) || (PUBLIC_SECRET_KEYS as readonly string[]).includes(key);
    if (looksSecret && value != null && value !== '' && typeof value !== 'boolean' && typeof value !== 'number') {
      found.push(path);
    }
    if (value && typeof value === 'object') {
      found.push(...secretValuesPresent(value, path));
    }
  }
  return found;
}

export function isFlagValue(v: unknown): boolean {
  return v === true || v === false || v === 0 || v === 1 || v === '0' || v === '1';
}
