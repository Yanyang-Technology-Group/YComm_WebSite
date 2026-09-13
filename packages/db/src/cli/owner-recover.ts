import { and, eq, isNull } from 'drizzle-orm';
import { createDb } from '../client';
import { sessions, users } from '../schema/identity';
import { auditLogs } from '../schema/system';
import { hashPassword } from '@ycomm/identity';
import { REGISTRATION } from '@ycomm/config';

/**
 * `npm run owner:recover` — rescue path for the single-owner deployment.
 *
 * Resets the owner's password from the server console, no web session and no
 * mail server required (mail box lost, mail broken, whatever). Usage:
 *
 *   npm run owner:recover -- --email owner@example.com --password <new-secret>
 *   npm run owner:recover -- --password <new-secret>        # when only one owner exists
 *
 * Or via env: YCOMM_OWNER_EMAIL / YCOMM_OWNER_PASSWORD.
 * All existing sessions of the owner are revoked.
 */
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const email = (arg('email') ?? process.env.YCOMM_OWNER_EMAIL)?.toLowerCase();
  const password = arg('password') ?? process.env.YCOMM_OWNER_PASSWORD;

  if (!password) {
    console.error('usage: npm run owner:recover -- --password <new-secret> [--email <mail>]');
    process.exit(1);
  }
  if (password.length < REGISTRATION.minPasswordLength || !REGISTRATION.passwordPattern.test(password)) {
    console.error(`password must be at least ${REGISTRATION.minPasswordLength} characters, with upper and lower case`);
    process.exit(1);
  }

  const handle = await createDb();
  try {
    const where = email ? and(eq(users.email, email), eq(users.role, 'owner')) : eq(users.role, 'owner');
    const owners = await handle.db
      .select({ id: users.id, username: users.username, email: users.email })
      .from(users)
      .where(where)
      .limit(email ? 1 : 2);

    if (owners.length === 0) {
      console.error(`No owner found${email ? ` for ${email}` : ''} — refusing to guess.`);
      process.exit(1);
    }
    if (owners.length > 1) {
      console.error('Multiple owner accounts exist; pass --email to pick one.');
      process.exit(1);
    }

    const owner = owners[0];
    if (!owner) {
      console.error('Unexpected: no owner row.');
      process.exit(1);
    }

    const passwordHash = await hashPassword(password);
    await handle.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ password_hash: passwordHash, updated_at: new Date() })
        .where(eq(users.id, owner.id));
      // Revoke every live session — password recovery invalidates all of them.
      await tx
        .update(sessions)
        .set({ revoked_at: new Date() })
        .where(and(eq(sessions.user_id, owner.id), isNull(sessions.revoked_at)));
      await tx.insert(auditLogs).values({
        actor_id: owner.id,
        action: 'owner.password_recovered',
        target_type: 'user',
        target_id: owner.id,
        meta: { via: 'cli' },
      });
    });

    console.log(`Password reset OK for owner ${owner.username} <${owner.email}>; all sessions revoked.`);
  } finally {
    await handle.close();
  }
}

await main();