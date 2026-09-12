import { and, eq, gt, isNull } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { AUTH } from '@ycomm/config';
import { errors, hashToken, newToken } from '@ycomm/kernel';
import { enqueue } from '@ycomm/jobs';
import { renderVerifyEmail } from '@ycomm/notify';
import { findUserByEmail } from './account';
import type { UserRecord } from './types';

const VERIFY_EMAIL_TTL_MS = AUTH.verificationTokenTtlMinutes * 60 * 1000;

/** Issue a fresh verification token and enqueue its mail. */
async function issueVerificationToken(db: Db, user: UserRecord, email: string): Promise<void> {
  const token = newToken(32);
  await db.insert(schema.emailTokens).values({
    user_id: user.id,
    purpose: 'verify_email',
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + VERIFY_EMAIL_TTL_MS),
  });
  const mail = renderVerifyEmail(token);
  await enqueue(db, 'send_email', {
    payload: {
      to: email,
      template: 'verify_email',
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    },
  });
}

export function issueVerificationTokenForUser(db: Db, user: UserRecord): Promise<void> {
  return issueVerificationToken(db, user, user.email);
}

/**
 * Redeem a verification token. One-time and time-limited; moves the account
 * from `unverified` to `active`.
 */
export async function verifyEmail(db: Db, rawToken: string): Promise<UserRecord> {
  const tokenHash = hashToken(rawToken);
  const rows = await db
    .select()
    .from(schema.emailTokens)
    .where(
      and(
        eq(schema.emailTokens.token_hash, tokenHash),
        eq(schema.emailTokens.purpose, 'verify_email'),
        isNull(schema.emailTokens.used_at),
        gt(schema.emailTokens.expires_at, new Date()),
      ),
    )
    .limit(1);

  const token = rows[0];
  if (!token) {
    throw errors.validation({ issues: [{ path: 'token', message: '验证链接无效或已过期' }] });
  }

  const updated = await db
    .update(schema.users)
    .set({ state: 'active', updated_at: new Date() })
    .where(eq(schema.users.id, token.user_id))
    .returning();

  await db.update(schema.emailTokens).set({ used_at: new Date() }).where(eq(schema.emailTokens.id, token.id));

  const user = updated[0] as UserRecord | undefined;
  if (!user) {
    throw errors.internal(undefined, 'Verification raced with account removal');
  }
  return user;
}

/**
 * Resend the verification mail. Enumeration-safe: unknown or already-verified
 * emails do nothing and produce the same response as a real resend.
 */
export async function resendVerification(db: Db, emailInput: string): Promise<void> {
  const email = emailInput.trim().toLowerCase();
  const user = await findUserByEmail(db, email);
  if (!user) return;
  if (user.state !== 'unverified') return;
  await issueVerificationToken(db, user, email);
}