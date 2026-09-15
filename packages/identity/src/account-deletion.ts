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
 * 注销生效时要释放的字段。
 *
 * 账号行不会删除（审计、帖子作者等还引用着它），但 `users` 上有
 * `lower(username)` / `lower(email)` 唯一索引 —— 不释放的话，本人想用同样的
 * 用户名/邮箱重新注册就会被当成「已被占用」。所以注销后改成一次性别名，
 * 同时清掉昵称、签名和头像，不再保留个人资料。
 */
function releasedIdentity(user: Pick<UserRecord, 'id'>) {
  const suffix = user.id.replace(/-/g, '').slice(0, 10);
  return {
    username: `deleted_${suffix}`,
    email: `deleted_${suffix}@deleted.invalid`,
    display_name: '已注销用户',
    bio: '',
    avatar_path: null,
  };
}

/**
 * 注销最终生效时，断开第三方登录（GitHub 等）关联。
 *
 * 不解除的话，oauth_accounts 上那条记录永远指着这个已注销账号：
 * 本人（或把 GitHub 转让后的新主人）再想用这个 GitHub 账号登录/绑定时，
 * 会被当成「已经绑定到其他用户」。所以注销 = 让位。
 */
async function releaseOAuthLinks(db: Db, userId: string): Promise<void> {
  await db.delete(schema.oauthAccounts).where(eq(schema.oauthAccounts.user_id, userId));
}

/** 封禁/禁言期间不允许自助注销（管理员仍可直接注销）。 */
function assertDeletionAllowed(user: UserRecord): void {
  if (user.state === 'banned') {
    throw errors.forbidden('账号处于封禁状态，暂时无法注销');
  }
  if (user.state === 'muted' && (user.muted_until === null || user.muted_until > new Date())) {
    throw errors.forbidden('账号处于禁言状态，暂时无法注销');
  }
}

/**
 * 把已注销账号占用的用户名/邮箱释放掉（幂等）。
 *
 * 新建账号前调用：老数据里可能还留着注销时尚未释放的用户名/邮箱，这里补一刀，
 * 让本人可以用原来的用户名或邮箱重新注册。
 */
export async function releaseDeletedIdentity(db: Db, userId: string): Promise<void> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user || user.state !== 'deleted') return;
  await db
    .update(schema.users)
    .set({ ...releasedIdentity(user), updated_at: new Date() })
    .where(eq(schema.users.id, user.id));
  // 顺手把 GitHub 等第三方绑定也让位（历史数据里可能还留着）。
  await releaseOAuthLinks(db, user.id);
}

/**
 * 这个老账号是否已经「不再占用」用户名/邮箱（注销完成）？
 *
 * - `deleted`：已完成注销，直接释放（顺手兼容历史数据）。
 * - `deleting` 且冷静期已过：即使没人再登录触发转正，也按永久注销处理并释放，
 *   否则冷静期一过没人登录，用户名/邮箱就被无限期占着。
 *
 * 返回 true 表示调用方可以继续用它注册新账号；false 表示该用户名/邮箱仍属于
 * 一个有效账号（deleting 冷静期内也算有效，因为登录可以复活）。
 */
export async function releaseIdentityIfDeletionDone(db: Db, user: UserRecord): Promise<boolean> {
  if (user.state === 'deleted') {
    await releaseDeletedIdentity(db, user.id);
    return true;
  }
  if (
    user.state === 'deleting' &&
    user.deleted_at !== null &&
    Date.now() - user.deleted_at.getTime() > GRACE_MS
  ) {
    await db
      .update(schema.users)
      .set({ state: 'deleted', ...releasedIdentity(user), updated_at: new Date() })
      .where(eq(schema.users.id, user.id));
    await revokeAllSessionsForUser(db, user.id);
    await releaseOAuthLinks(db, user.id);
    return true;
  }
  return false;
}

/**
 * 第一步：给用户邮箱发注销确认邮件（含一次性 token 链接）。
 * 枚举安全：不存在 / 已注销 / 已在冷静期的账号一律无差别「成功」。
 * 封禁/禁言则明确拒绝——这是已登录用户操作自己的账号，不存在枚举风险。
 */
export async function requestAccountDeletion(db: Db, userId: string): Promise<void> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user || user.state === 'deleted' || user.state === 'deleting') return;
  assertDeletionAllowed(user);

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
 *
 * 冷静期起点的用户名/邮箱保持原样（否则无法复活）；真正释放发生在冷静期
 * 结束或站长直接注销时。
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

  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, token.user_id)).limit(1);
  if (!user) {
    throw errors.validation({ issues: [{ path: 'token', message: '注销链接无效或已过期' }] });
  }
  // 冷静期开始之后被处罚的账号：注销不生效（避免用注销躲避封禁）。
  assertDeletionAllowed(user);

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
      // 冷静期结束：永久注销，同时释放用户名/邮箱供本人以后重新注册。
      ...(within ? {} : releasedIdentity(user)),
      updated_at: new Date(),
    })
    .where(eq(schema.users.id, user.id))
    .returning();
  if (!within) {
    await revokeAllSessionsForUser(db, user.id);
    // GitHub 等第三方绑定一起让位。
    await releaseOAuthLinks(db, user.id);
  }
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
      // 立即生效：同样释放用户名/邮箱，本人之后可以用原邮箱重新注册。
      .set({ state: 'deleted', deleted_at: new Date(), ...releasedIdentity(user), updated_at: new Date() })
      .where(eq(schema.users.id, userId));
    await revokeAllSessionsForUser(tx as unknown as Db, userId);
    // GitHub 等第三方绑定也让位，同一个 GitHub 之后可以绑到别的账号。
    await releaseOAuthLinks(tx as unknown as Db, userId);
  });
}