import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

/**
 * Dev/demo seed: one login per role so every RBAC path can be exercised
 * from the UI. Idempotent (upserts by email) — safe to re-run; it also
 * resets the password of an existing demo user, so stale accounts from
 * manual testing become usable again.
 *
 * Password comes from SEED_PASSWORD (rule 11: secrets from env); the
 * fallback below is a documented dev-only convenience, and the seed
 * refuses to run in production.
 */
const prisma = new PrismaClient();

const BCRYPT_COST = 12; // keep in sync with auth.service.ts
const DEFAULT_ORG = { slug: 'default', name: 'Default Organization' };

const DEMO_USERS: { email: string; fullName: string; role: Role }[] = [
  { email: 'admin@opspilot.dev', fullName: 'Ada Admin', role: 'ADMIN' },
  { email: 'engineer@opspilot.dev', fullName: 'Evan Engineer', role: 'ENGINEER' },
  { email: 'viewer@opspilot.dev', fullName: 'Vera Viewer', role: 'VIEWER' },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo credentials in production');
  }
  const password = process.env.SEED_PASSWORD ?? 'Password123!';
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  const org = await prisma.organization.upsert({
    where: { slug: DEFAULT_ORG.slug },
    create: DEFAULT_ORG,
    update: {},
  });

  for (const user of DEMO_USERS) {
    await prisma.user.upsert({
      where: { email: user.email },
      create: { ...user, organizationId: org.id, passwordHash },
      update: { role: user.role, passwordHash, isActive: true, deletedAt: null },
    });
  }

  console.log(`Seeded ${DEMO_USERS.length} demo users (org "${org.slug}"):`);
  for (const user of DEMO_USERS) console.log(`  ${user.role.padEnd(8)} ${user.email}`);
  console.log(`Password: ${process.env.SEED_PASSWORD ? '(from SEED_PASSWORD)' : password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
