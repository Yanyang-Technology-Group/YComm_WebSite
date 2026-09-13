import { and, eq, gt, isNull } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { AUTH, validatePassword } from '@ycomm/config';
import { errors, hashToken, newToken } from '@ycomm/kernel';
import { enqueue } from '@ycomm/jobs';
import { renderPasswordReset } from '@ycomm/notify';
import { findUserByEmail } from './account';
import { hashPassword } from './password';
import { revokeAllSessionsForUser } from './sessions';

const RESET_TTL_MS = AUTH.resetTokenTtlMinutes * 60 * 1000;

/**
 * Request a password reset for an email address.
 *
 * Enumeration-safe by design: unknown addresses and inactive accounts respond
 * identically — only a real reset token is ever mailed, the caller can't tell
 * whether the address exists.
 */
export async function requestPasswordReset(db: Db, emailInput: string): Promise<void> {
  const email = emailInput.trim().toLowerCase();
  const user = await findUserByEmail(db, email);
  if (!user) return;
  // Nobody gets a reset link for a deleted or banned account.
  if (user.state === 'deleted' || user.state === 'banned') return;

  const token = newToken(32);
  await db.insert(schema.emailTokens).values({
    user_id: user.id,
    purpose: 'reset_password',
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + RESET_TTL_MS),
  });
  const mail = renderPasswordReset(token, AUTH.resetTokenTtlMinutes);
  await enqueue(db, 'send_email', {
    payload: {
      to: email,
      template: 'password_reset',
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    },
  });
}

/**
 * Redeem a reset token and set a new password. All existing sessions are
 * revoked — a stolen session does not survive a password change.
 */
export async function resetPassword(db: Db, rawToken: string, newPassword: string): Promise<void> {
  const passwordIssue = validatePassword(newPassword);
  if (passwordIssue) {
    throw errors.validation({ issues: [{ path: 'password', message: passwordIssue }] });
  }

  const tokenHash = hashToken(rawToken);
  const rows = await db
    .select()
    .from(schema.emailTokens)
    .where(
      and(
        eq(schema.emailTokens.token_hash, tokenHash),
        eq(schema.emailTokens.purpose, 'reset_password'),
        isNull(schema.emailTokens.used_at),
        gt(schema.emailTokens.expires_at, new Date()),
      ),
    )
    .limit(1);

  const token = rows[0];
  if (!token) {
    throw errors.validation({ issues: [{ path: 'token', message: '重置链接无效或已过期' }] });
  }

  const passwordHash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ password_hash: passwordHash, updated_at: new Date() })
      .where(eq(schema.users.id, token.user_id));
    await revokeAllSessionsForUser(tx as unknown as Db, token.user_id);
    await tx.update(schema.emailTokens).set({ used_at: new Date() }).where(eq(schema.emailTokens.id, token.id));
  });
}