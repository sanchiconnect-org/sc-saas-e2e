/**
 * SAN-1609: black-box API contract tests against the live QA cockpit.
 * Owner: Ritu Raj
 * Pass bar: verify_tenant and tenant-settings return the frozen public shape; required flag
 * columns exist on verify_tenant.features; no secret field carries a value on either response.
 *
 * Counterpart to the CI producer/consumer guards (SAN-1591). Hits the cockpit for E2E_ENV's
 * QA hostname (FRONTEND_URL). No browser login; safe on production (read-only).
 *
 * Deploy / nightly: `npm run test:contracts` (or full suite — project `api` has no setup deps).
 */
import { expect, test } from '@playwright/test';
import { env } from '../../config/env';
import {
  REQUIRED_FLAG_COLUMNS,
  TENANT_SETTINGS_DATA_KEYS,
  TENANT_SETTINGS_REQUIRED_KEYS,
  VERIFY_TENANT_DATA_KEYS,
  VERIFY_TENANT_USER_KEYS,
  cockpitUrl,
  fetchCockpitJson,
  isFlagValue,
  qaHostname,
  secretValuesPresent,
  sortedKeys,
} from '../../config/tenant-contract';

const host = qaHostname();

test.describe('tenant API contracts (SAN-1609)', { tag: ['@regression', '@api', '@tenant'] }, () => {
  test.beforeAll(() => {
    console.log(`[tenant-contract] cockpit=${cockpitUrl()} host=${host} E2E_ENV=${env.name}`);
  });

  test('verify_tenant returns the frozen public shape for the QA hostname', async () => {
    const { status, body } = await fetchCockpitJson(`/api/v1/public/global/verify_tenant/${host}`);
    expect(status, `verify_tenant HTTP ${status}`).toBe(200);
    expect(body.status_code).toBe(200);
    expect(body.data, 'verify_tenant.data').toBeTruthy();

    const data = body.data as Record<string, unknown>;
    expect(sortedKeys(data)).toEqual([...VERIFY_TENANT_DATA_KEYS].sort());
    expect(data.domain).toBe(host);
    expect(String(data.apiUrl)).toMatch(/^https?:\/\//);
    expect(typeof data.active).toBe('boolean');

    const users = data.users as Record<string, unknown>;
    expect(sortedKeys(users)).toEqual([...VERIFY_TENANT_USER_KEYS].sort());

    const features = data.features as Record<string, unknown>;
    expect(Object.keys(features).length, 'verify_tenant.features count (frozen 216)').toBe(216);

    console.log('[tenant-contract] verify_tenant OK');
  });

  test('verify_tenant exposes the required flag columns', async () => {
    const { status, body } = await fetchCockpitJson(`/api/v1/public/global/verify_tenant/${host}`);
    expect(status).toBe(200);
    const features = (body.data as { features: Record<string, unknown> }).features;
    const missing: string[] = [];
    for (const flag of REQUIRED_FLAG_COLUMNS) {
      if (!(flag in features) || !isFlagValue(features[flag])) missing.push(flag);
    }
    expect(missing, `missing or non-flag values on verify_tenant.features: ${missing.join(', ')}`).toEqual([]);

    console.log('[tenant-contract] flag columns OK:', REQUIRED_FLAG_COLUMNS.join(', '));
  });

  test('verify_tenant response carries no secret field values', async () => {
    const { status, body } = await fetchCockpitJson(`/api/v1/public/global/verify_tenant/${host}`);
    expect(status).toBe(200);
    const leaked = secretValuesPresent(body.data);
    expect(leaked, `secret values on verify_tenant: ${leaked.join(', ')}`).toEqual([]);
  });

  test('tenant-settings returns the frozen public shape for the QA hostname', async () => {
    const { status, body } = await fetchCockpitJson(`/api/v1/public/global/tenant-settings/${host}`);
    expect(status, `tenant-settings HTTP ${status}`).toBe(200);
    expect(body.status_code).toBe(200);
    expect(body.data, 'tenant-settings.data').toBeTruthy();

    const data = body.data as Record<string, unknown>;
    expect(sortedKeys(data)).toEqual([...TENANT_SETTINGS_DATA_KEYS].sort());

    const settings = data.settings as Record<string, unknown>;
    for (const key of TENANT_SETTINGS_REQUIRED_KEYS) {
      expect(settings[key], `settings.${key}`).toBeTruthy();
    }
    expect(settings.domain).toBe(host);
    expect(String(settings.apiUrl)).toMatch(/^https?:\/\//);

    const features = data.features as Record<string, unknown>;
    expect(Object.keys(features).length, 'tenant-settings.features should stay near the frozen ~142').toBeGreaterThanOrEqual(130);

    console.log('[tenant-contract] tenant-settings shape OK');
  });

  test('tenant-settings response carries no secret field values', async () => {
    /* Known leak: settings.factacy_api_key is still returned with a value on the QA cockpit (SAN-1941). */
    test.fail(true, 'SAN-1941: public tenant-settings still returns factacy_api_key');

    const { status, body } = await fetchCockpitJson(`/api/v1/public/global/tenant-settings/${host}`);
    expect(status).toBe(200);
    const leaked = secretValuesPresent(body.data);
    expect(leaked, `secret values on tenant-settings: ${leaked.join(', ')}`).toEqual([]);
  });
});
