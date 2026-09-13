import { eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { FEATURE_DEFAULTS, REGISTRATION, validatePassword } from '@ycomm/config';
import { errors, hashToken, newToken } from '@ycomm/kernel';
import { enqueue } from '@ycomm/jobs';
import { renderVerifyEmail } from '@ycomm/notify';
import { hashPassword } from './password';
import { consumeInviteCode } from './invites';
import { findUserByEmail, hasAnyUser } from './account';
import { releaseIdentityIfDeletionDone } from './account-deletion';
import type { UserRecord } from './types';
import { getSetting } from '@ycomm/db';

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
  inviteCode?: string;
}

export interface RegisterResult {
  user: UserRecord;
  needsVerification: boolean;
  /**
   * true when the request collided with an existing email — the response is
   * identical to a successful registration (enumeration protection).
   */
  alreadyRegistered: boolean;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Register a new member.
 *
 * Enumeration protection: an existing email returns the same shape as success
 * (`alreadyRegistered: true`) — the endpoint never reveals whether an address
 * is taken. Usernames are public, so their collisions are real CONFLICTs.
 */
export async function register(db: Db, input: RegisterInput): Promise<RegisterResult> {
  if (!(await hasAnyUser(db))) {
    throw errors.siteNotInitialized();
  }

  const registrationOpen =
    ((await getSetting(db, 'registrationOpen')) as boolean | undefined) ??
    FEATURE_DEFAULTS.registrationOpen;
  if (!registrationOpen) {
    throw errors.registrationClosed();
  }

  const username = input.username.trim();
  const email = input.email.trim().toLowerCase();

  if (!REGISTRATION.usernamePattern.test(username)) {
    throw errors.validation({ issues: [{ path: 'username', message: REGISTRATION.usernameHint }] });
  }
  if ((REGISTRATION.reservedUsernames as readonly string[]).includes(username.toLowerCase())) {
    throw errors.conflict('这个用户名是保留名称，换一个试试', { field: 'username' });
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw errors.validation({ issues: [{ path: 'email', message: '邮箱格式不正确' }] });
  }
  const passwordIssue = validatePassword(input.password);
  if (passwordIssue) {
    throw errors.validation({ issues: [{ path: 'password', message: passwordIssue }] });
  }

  const usernameTaken = await db
    .select()
    .from(schema.users)
    .where(eq(sql`lower(${schema.users.username})`, username.toLowerCase()))
    .limit(1);
  const existingUsername = usernameTaken[0];
  if (existingUsername && !(await releaseIdentityIfDeletionDone(db, existingUsername))) {
    throw errors.conflict('该用户名已被别人用了，换一个吧', { field: 'username' });
  }

  const existingByEmail = await findUserByEmail(db, email);
  if (existingByEmail && !(await releaseIdentityIfDeletionDone(db, existingByEmail))) {
    return { user: existingByEmail, needsVerification: false, alreadyRegistered: true };
  }

  if (REGISTRATION.requireInviteByDefault && !input.inviteCode) {
    throw errors.inviteRequired();
  }

  const passwordHash = await hashPassword(input.password);
  const needsVerification =
    ((await getSetting(db, 'emailVerificationRequired')) as boolean | undefined) ??
    FEATURE_DEFAULTS.emailVerificationRequired;

  // Create the user first, then claim the invite inside the same transaction so
  // the `invite_code_uses.user_id` FK is always satisfied and a failed claim
  // rolls the whole registration back.
  const user = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(schema.users)
      .values({
        username,
        email,
        password_hash: passwordHash,
        state: needsVerification ? 'unverified' : 'active',
        display_name: username,
      })
      .returning();
    const created = inserted as UserRecord;

    if (input.inviteCode) {
      const claimed = await consumeInviteCode(tx as unknown as Db, input.inviteCode, created.id);
      if (!claimed) {
        throw errors.validation({ issues: [{ path: 'inviteCode', message: '邀请码无效或已用完' }] });
      }
      if (claimed.createdBy) {
        await tx
          .update(schema.users)
          .set({ invited_by: claimed.createdBy })
          .where(eq(schema.users.id, created.id));
      }
    }

    return created;
  });

  if (needsVerification) {
    const token = newToken(32);
    await db.insert(schema.emailTokens).values({
      user_id: user.id,
      purpose: 'verify_email',
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
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

  return { user, needsVerification, alreadyRegistered: false };
}