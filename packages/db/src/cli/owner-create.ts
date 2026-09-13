import { eq } from 'drizzle-orm';
import { createDb } from '../client';
import { users } from '../schema/identity';
import { hashPassword } from '@ycomm/identity';
import { REGISTRATION } from '@ycomm/config';

/**
 * `npm run owner:create` — bootstrap the single owner account.
 *
 * A site with no owner rejects registrations (NOT_INITIALIZED), which is the
 * safe default compared to "first registrant wins". Usage:
 *
 *   npm run owner:create -- --username alice --email alice@example.com --password <secret>
 *
 * Or via env: YCOMM_OWNER_USERNAME / YCOMM_OWNER_EMAIL / YCOMM_OWNER_PASSWORD.
 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const username = arg('username') ?? process.env.YCOMM_OWNER_USERNAME;
  const email = (arg('email') ?? process.env.YCOMM_OWNER_EMAIL)?.toLowerCase();
  const password = arg('password') ?? process.env.YCOMM_OWNER_PASSWORD;

  if (!username || !email || !password) {
    console.error(
      'usage: npm run owner:create -- --username <name> --email <mail> --password <secret>\n' +
        '       (or set YCOMM_OWNER_USERNAME / YCOMM_OWNER_EMAIL / YCOMM_OWNER_PASSWORD)',
    );
    process.exit(1);
  }
  if (!REGISTRATION.usernamePattern.test(username)) {
    console.error(`username must match ${REGISTRATION.usernamePattern.source}`);
    process.exit(1);
  }
  if (password.length < REGISTRATION.minPasswordLength || !REGISTRATION.passwordPattern.test(password)) {
    console.error(`password must be at least ${REGISTRATION.minPasswordLength} characters, with upper and lower case`);
    process.exit(1);
  }

  const handle = await createDb();
  try {
    const existing = await handle.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.role, 'owner'))
      .limit(1);
    if (existing.length > 0) {
      console.error(`Owner already exists (${existing[0]?.username}) — refusing to create a second one.`);
      process.exit(1);
    }

    const passwordHash = await hashPassword(password);
    await handle.db.insert(users).values({
      username,
      email,
      password_hash: passwordHash,
      role: 'owner',
      state: 'active',
      display_name: username,
      level: 4, // the owner starts at the top tier
    });

    console.log(`Owner created: ${username} <${email}>`);
  } finally {
    await handle.close();
  }
}

await main();