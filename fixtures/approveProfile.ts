import { chromium, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { adminAccount, authFile, type MemberRole } from '../config/accounts';
import { env } from '../config/env';
import { AdminLoginPage } from '../pages/admin/AdminLoginPage';
import { parseAdminJson } from './cfa';

/** Admin table + detail-page paths for profile approval (Accept on *-detail/{id}/details). */
const STAKE: Partial<
  Record<MemberRole, { table: string; search: string; profileType: string; detailBase: string }>
> = {
  startup: { table: 'startups', search: 'QA Startup', profileType: 'startup', detailBase: 'startup-detail' },
  investor: { table: 'investors', search: 'QA Investor', profileType: 'investor', detailBase: 'investor-detail' },
  mentor: { table: 'mentors', search: 'QA Mentor', profileType: 'mentor', detailBase: 'mentor-detail' },
  corporate: { table: 'corporates', search: 'QA Corporate', profileType: 'corporate', detailBase: 'corporate-detail' },
};

async function adminApi(): Promise<APIRequestContext> {
  const account = adminAccount('admin');
  if (!account) throw new Error('QA_ADMIN_EMAIL / QA_ADMIN_PASSWORD not set');

  const saved = await playwrightRequest.newContext({
    baseURL: env.adminUrl,
    storageState: authFile('admin'),
  });
  const probe = await saved.get('/table/startups', { maxRedirects: 0 });
  if (probe.status() < 300) return saved;
  await saved.dispose();

  /* Frontend project does not depend on setup-admin — log in when the saved session is missing/expired. */
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ baseURL: env.adminUrl });
    const page = await ctx.newPage();
    await new AdminLoginPage(page).login(account.email, account.password);
    return playwrightRequest.newContext({
      baseURL: env.adminUrl,
      storageState: await ctx.storageState(),
    });
  } finally {
    await browser.close();
  }
}

/**
 * Approve a seeded QA member profile via the admin panel backdoor token +
 * `POST /api/v1/admin-actions/approve/{type}/{id}/{token}`.
 */
export async function approveMemberProfile(role: MemberRole) {
  const stake = STAKE[role];
  if (!stake) throw new Error(`No admin approve mapping for role ${role}`);

  const admin = await adminApi();
  try {
    const list = await admin.post(`/table/${stake.table}?sortby=id:DESC&perpage=50`, {
      form: { q: stake.search },
      maxRedirects: 0,
    });
    if (list.status() >= 300 && list.status() < 400) {
      throw new Error(`admin session expired listing ${stake.table}`);
    }
    const listHtml = await list.text();
    const id = [...listHtml.matchAll(/record_id="(\d+)"/g)].map((m) => m[1])[0];
    if (!id) throw new Error(`No ${stake.table} row matching search "${stake.search}"`);

    const detailPath = `/${stake.detailBase}/${id}/details`;
    /* The backdoor token is the QA admin's one current token, so tests running in parallel can replace
       it between generate and approve: the backend then answers 404 "Admin not found". Each attempt
       generates a fresh token; a third failure is a real one. */
    for (let attempt = 1; ; attempt++) {
      const tokenRes = await admin.post(detailPath, {
        form: { submitAction: 'generateBackdoorToken' },
        maxRedirects: 0,
      });
      const tokenJson = parseAdminJson('generateBackdoorToken', tokenRes.status(), await tokenRes.text());
      if (!tokenJson.success || !tokenJson.successMessage) {
        throw new Error(`generateBackdoorToken failed for ${role} #${id}: ${JSON.stringify(tokenJson)}`);
      }

      const api = await playwrightRequest.newContext({
        baseURL: env.apiUrl,
        extraHTTPHeaders: { 'x-hostname': new URL(env.frontendUrl).hostname },
      });
      try {
        const approve = await api.post(
          `/api/v1/admin-actions/approve/${stake.profileType}/${id}/${tokenJson.successMessage}`,
          { data: { approvalMessage: `QA e2e approve ${role}` } },
        );
        const text = await approve.text();
        if (approve.status() === 404 && /Admin not found/i.test(text) && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
          continue;
        }
        /* 409 "already approved" is fine — idempotent for re-runs. */
        if (!approve.ok() && !(approve.status() === 409 && /already approved/i.test(text))) {
          throw new Error(`approve ${role} #${id} → HTTP ${approve.status()}: ${text.slice(0, 300)}`);
        }
        return { id, status: approve.status(), body: text };
      } finally {
        await api.dispose();
      }
    }
  } finally {
    await admin.dispose();
  }
}

/** Approve every role in `roles` (needs QA admin credentials). */
export async function approveMemberProfiles(roles: MemberRole[]) {
  for (const role of roles) await approveMemberProfile(role);
}
