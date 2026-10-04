import { and, eq, gt, isNull } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { AUTH } from '@ycomm/config';
import { errors, hashToken, newToken } from '@ycomm/kernel';
import { enqueue } from '@ycomm/jobs';
import {
  renderDeviceVerification,
  renderVerifyEmail,
  renderVerifyEmailReminder,
  type RenderedMail,
} from '@ycomm/notify';
import { findUserByEmail } from './account';
import type { UserRecord } from './types';

const VERIFY_EMAIL_TTL_MS = AUTH.verificationTokenTtlMinutes * 60 * 1000;
const DEVICE_TOKEN_TTL_MS = AUTH.deviceVerificationTtlMinutes * 60 * 1000;

/**
 * 这个地址能不能真的收到信。
 *
 * OAuth 注册的账号如果 GitHub 没给可用邮箱，会落一个 `xxx@users.noreply` 占位地址：
 * 那时候邮箱既验证不了，也不该拿它做新设备确认。
 */
export function isDeliverableEmail(email: string): boolean {
  const value = email.trim().toLowerCase();
  return value.includes('@') && !value.endsWith('@users.noreply');
}

interface TokenMail {
  /** `email_tokens.purpose`：决定哪个接口能兑换它。 */
  purpose: 'verify_email' | 'verify_device';
  /** `email_logs.template`：纯展示与排查用。 */
  template: string;
  ttlMs: number;
  deviceHash?: string | null;
  build: (token: string) => RenderedMail;
}

/** 落一个一次性令牌，并把对应邮件排进队列。 */
async function issueToken(db: Db, user: UserRecord, email: string, input: TokenMail): Promise<void> {
  const token = newToken(32);
  await db.insert(schema.emailTokens).values({
    user_id: user.id,
    purpose: input.purpose,
    token_hash: hashToken(token),
    device_hash: input.deviceHash ?? null,
    expires_at: new Date(Date.now() + input.ttlMs),
  });
  const mail = input.build(token);
  await enqueue(db, 'send_email', {
    payload: {
      to: email,
      template: input.template,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    },
  });
}

/** Issue a fresh verification token and enqueue its mail. */
export function issueVerificationTokenForUser(db: Db, user: UserRecord): Promise<void> {
  return issueToken(db, user, user.email, {
    purpose: 'verify_email',
    template: 'verify_email',
    ttlMs: VERIFY_EMAIL_TTL_MS,
    build: renderVerifyEmail,
  });
}

/**
 * 未验证邮箱的定期提醒（清道夫任务每 6 小时调一次）。
 *
 * 令牌 purpose 仍是 `verify_email` —— 用户点提醒邮件里的链接走的是同一个验证接口。
 * 邮件里写明「还剩多久会被自动注销」，这是自动清理机制唯一的告知渠道。
 */
export async function sendVerificationReminder(
  db: Db,
  user: UserRecord,
  hoursLeft: number,
): Promise<void> {
  await issueToken(db, user, user.email, {
    purpose: 'verify_email',
    template: 'verify_email_reminder',
    ttlMs: VERIFY_EMAIL_TTL_MS,
    build: (token) =>
      renderVerifyEmailReminder(token, {
        hoursLeft,
        graceDays: AUTH.verificationGraceDays,
        reminderHours: AUTH.verificationReminderHours,
        tokenTtlMinutes: AUTH.verificationTokenTtlMinutes,
      }),
  });
}

/**
 * 新设备登录确认：令牌记住这台设备的指纹，本人点链接后写进 `trusted_devices`。
 */
export async function issueDeviceVerificationToken(
  db: Db,
  user: UserRecord,
  input: { deviceHash: string; deviceLabel: string; ip: string | null },
): Promise<void> {
  await issueToken(db, user, user.email, {
    purpose: 'verify_device',
    template: 'verify_device',
    ttlMs: DEVICE_TOKEN_TTL_MS,
    deviceHash: input.deviceHash,
    build: (token) =>
      renderDeviceVerification(token, {
        deviceLabel: input.deviceLabel,
        ip: input.ip,
        at: new Date(),
        tokenTtlMinutes: AUTH.deviceVerificationTtlMinutes,
      }),
  });
}

/**
 * 兑换新设备确认令牌：一次性、限时。返回该信任哪个用户、哪台设备；
 * 令牌无效/过期/已用过一律返回 null（调用方给统一提示，不泄漏细节）。
 */
export async function verifyDeviceToken(
  db: Db,
  rawToken: string,
): Promise<{ userId: string; deviceHash: string } | null> {
  const rows = await db
    .select()
    .from(schema.emailTokens)
    .where(
      and(
        eq(schema.emailTokens.token_hash, hashToken(rawToken)),
        eq(schema.emailTokens.purpose, 'verify_device'),
        isNull(schema.emailTokens.used_at),
        gt(schema.emailTokens.expires_at, new Date()),
      ),
    )
    .limit(1);

  const token = rows[0];
  if (!token?.device_hash) return null;

  await db.update(schema.emailTokens).set({ used_at: new Date() }).where(eq(schema.emailTokens.id, token.id));
  return { userId: token.user_id, deviceHash: token.device_hash };
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
  await issueToken(db, user, email, {
    purpose: 'verify_email',
    template: 'verify_email',
    ttlMs: VERIFY_EMAIL_TTL_MS,
    build: renderVerifyEmail,
  });
}
