/**
 * Seeded QA accounts — one per stakeholder type, plus an admin and a jury member.
 *
 * Only the *shape* lives here. Emails, passwords and the OTP come from
 * environment variables (GitHub secrets in CI, a git-ignored .env.<env> locally).
 * Never write a real credential into this file, the README, or Linear.
 */

/** Member stakeholder types — values match the backend `Role` enum (sc-saas-backend/src/core/constants/enum.ts). */
export const MEMBER_ROLES = [
  'startup',
  'investor',
  'corporate',
  'mentor',
  'partner',
  'service_provider',
  'individual',
  'program_office',
] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** Admin-panel users live in spa_admin_users (per-tenant DB) and log in with email + password. */
export const ADMIN_ROLES = ['admin', 'jury'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export type QARole = MemberRole | AdminRole;

const envKey = (role: QARole) => role.toUpperCase();

export interface MemberAccount {
  role: MemberRole;
  email: string;
}

export interface AdminAccount {
  role: AdminRole;
  email: string;
  password: string;
}

/** Returns the seeded member account for a role, or undefined if its secret isn't configured. */
export function memberAccount(role: MemberRole): MemberAccount | undefined {
  const email = process.env[`QA_${envKey(role)}_EMAIL`];
  return email ? { role, email } : undefined;
}

export function adminAccount(role: AdminRole): AdminAccount | undefined {
  const email = process.env[`QA_${envKey(role)}_EMAIL`];
  const password = process.env[`QA_${envKey(role)}_PASSWORD`];
  return email && password ? { role, email, password } : undefined;
}

/**
 * The OTP the QA backend accepts for seeded accounts.
 * Depends on the backend's env-gated fixed-OTP allowlist being enabled on the QA
 * deployment only — see README "Logging in without a real inbox".
 */
export function qaOtp(): string {
  const otp = process.env.QA_OTP;
  if (!otp) throw new Error('QA_OTP is not set. See env.example.');
  return otp;
}

/** Where a role's logged-in browser state is saved by the setup project. */
export const authFile = (role: QARole) => `.auth/${role}.json`;
