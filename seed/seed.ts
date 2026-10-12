/**
 * Seeds the QA tenant with one member account per stakeholder type.
 *
 *   E2E_ENV=staging npm run seed
 *
 * Idempotent: an account whose email already exists is left alone, so this is
 * safe to run repeatedly (and is what the nightly reset will call — SAN-1613).
 *
 * Admin and jury accounts are NOT created here: the backend has no API for
 * spa_admin_users. Create them once in the QA tenant's admin panel
 * (modules/auth/admins.php) and store their credentials as secrets — see README.
 */
import { env } from '../config/env';
import { MEMBER_ROLES, MemberRole, memberAccount, qaOtp } from '../config/accounts';
import { emailExists, register, verifiedEmailId } from './api';

/** Fields RegisterUserDto requires per userType (sc-saas-backend/src/modules/auth/dto/register-user.dto.ts). */
const PROFILE: Record<MemberRole, Record<string, unknown>> = {
  startup: { companyName: 'QA Startup Pvt Ltd' },
  investor: { investorType: 'individual' },
  corporate: { companyName: 'QA Corporate Ltd', designation: 'QA Lead' },
  mentor: {},
  /* Partner registration also creates a partner record; organizationName is required. */
  partner: { organizationName: 'QA Partner Org' },
  service_provider: {},
  individual: {},
  program_office: {},
};

const displayName = (role: MemberRole) =>
  'QA ' + role.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

async function seedMember(role: MemberRole, otp: string): Promise<'created' | 'exists' | 'skipped'> {
  const account = memberAccount(role);
  if (!account) return 'skipped';

  if (await emailExists(account.email)) return 'exists';

  const name = displayName(role);
  const emailVerificationId = await verifiedEmailId(account.email, name, otp);
  await register({
    name,
    emailAddress: account.email,
    emailVerificationId,
    userType: role,
    ...PROFILE[role],
  });
  return 'created';
}

async function main() {
  console.log(`Seeding QA tenant on ${env.name} (${env.apiUrl})`);
  const otp = qaOtp();
  let failed = 0;

  /* Sequential on purpose: the OTP endpoints are rate-limited to 10 requests a minute. */
  for (const role of MEMBER_ROLES) {
    try {
      const result = await seedMember(role, otp);
      const note = result === 'skipped' ? ` (QA_${role.toUpperCase()}_EMAIL not set)` : '';
      console.log(`  ${role.padEnd(18)} ${result}${note}`);
    } catch (err) {
      failed++;
      console.error(`  ${role.padEnd(18)} FAILED — ${(err as Error).message}`);
    }
  }

  if (failed) {
    console.error(`\n${failed} account(s) failed to seed.`);
    process.exit(1);
  }
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
