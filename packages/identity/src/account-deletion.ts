import { and, eq, gt, isNull } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { AUTH } from '@ycomm/config';
import { errors, hashToken, newToken } from '@ycomm/kernel';
import { enqueue } from '@ycomm/jobs';
import { renderAccountDeletion } from '@ycomm/notify';
import type { UserRecord } from './types';
import { revokeAllSessionsForUser } from './sessions';

const TOKEN_TTL_MS = AUTH.deleteAccountTokenTtlMinutes * 60 * 1000;
const GRACE_MS = AUTH.accountDeletionGraceDays * 86400_000;

/**
 * 第一步：给用户邮箱发注销确认邮件（含一次性 token 链接）。
 * 枚举安全：不存在 / 已注销 / 已封禁 / 已在冷静期的账号一律无差别「成功」。
 */
export async function requestAccountDeletion(db: Db, userId: string): Promise<void> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user || user.state === 'deleted' || user.state === 'banned' || user.state === 'deleting') return;

  const token = newToken(32);
  await db.insert(schema.emailTokens).values({
    user_id: user.id,
    purpose: 'delete_account',
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + TOKEN_TTL_MS),
  });
  const mail = renderAccountDeletion(token, AUTH.accountDeletionGraceDays, AUTH.deleteAccountTokenTtlMinutes);
  await enqueue(db, 'send_email', {
    payload: {
      to: user.email,
      template: 'account_deletion',
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    },
  });
}

/**
 * 第二步：点击邮件里的链接 → 确认注销。
 * 账户进入 `deleting`（冷静期，deleted_at 记录开始时间），并吊销全部会话；
 * 冷静期内重新登录即自动取消注销。
 */
export async function confirmAccountDeletion(db: Db, rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  const rows = await db
    .select()
    .from(schema.emailTokens)
    .where(
      and(
        eq(schema.emailTokens.token_hash, tokenHash),
        eq(schema.emailTokens.purpose, 'delete_account'),
        isNull(schema.emailTokens.used_at),
        gt(schema.emailTokens.expires_at, new Date()),
      ),
    )
    .limit(1);
  const token = rows[0];
  if (!token) {
    throw errors.validation({ issues: [{ path: 'token', message: '注销链接无效或已过期' }] });
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ state: 'deleting', deleted_at: new Date(), updated_at: new Date() })
      .where(eq(schema.users.id, token.user_id));
    await revokeAllSessionsForUser(tx as unknown as Db, token.user_id);
    await tx.update(schema.emailTokens).set({ used_at: new Date() }).where(eq(schema.emailTokens.id, token.id));
  });
}

/** 显式取消注销（登录自动取消之外的补充入口）：仅冷静期内有效。 */
export async function cancelAccountDeletion(db: Db, userId: string): Promise<void> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user || user.state !== 'deleting') return;
  await db
    .update(schema.users)
    .set({ state: 'active', deleted_at: null, updated_at: new Date() })
    .where(eq(schema.users.id, userId));
}

/**
 * 登录时调用：冷静期内登录 = 取消注销（复活为 active）；
 * 已过 3 天冷静期 → 转为永久 deleted（并清掉残余会话），登录被拒。
 * 非 deleting 状态原样返回。
 */
export async function reviveIfPendingDeletion(db: Db, user: UserRecord): Promise<UserRecord | null> {
  if (user.state !== 'deleting') return user;
  const within = user.deleted_at !== null && Date.now() - user.deleted_at.getTime() <= GRACE_MS;
  const nextState = within ? 'active' : 'deleted';
  const [updated] = await db
    .update(schema.users)
    .set({
      state: nextState,
      deleted_at: within ? null : user.deleted_at,
      updated_at: new Date(),
    })
    .where(eq(schema.users.id, user.id))
    .returning();
  if (!within) await revokeAllSessionsForUser(db, user.id);
  return updated ?? null;
}

/** 站长直接注销某个账号：立即生效、无冷静期（owner 自己被保护）。 */
export async function deleteAccountNow(db: Db, userId: string): Promise<void> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user || user.state === 'deleted') throw errors.notFound('账号不存在');
  if (user.role === 'owner') throw errors.forbidden('不能注销站长账号');

  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ state: 'deleted', deleted_at: new Date(), updated_at: new Date() })
      .where(eq(schema.users.id, userId));
    await revokeAllSessionsForUser(tx as unknown as Db, userId);
  });
}