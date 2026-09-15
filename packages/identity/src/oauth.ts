import { and, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import { releaseDeletedIdentity, releaseIdentityIfDeletionDone } from './account-deletion';
import type { UserRecord } from './types';

export interface OAuthProfile {
  provider: 'github' | 'google';
  providerAccountId: string;
  username: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * OAuth 登录的 find-or-create：
 * 1) 该 provider 账号已关联 → 直接返回其用户；
 * 2) 邮箱匹配到既有账号 → 关联上去；
 * 3) 否则新建用户（OAuth 视为已验证，state=active）。
 *
 * 已注销的账号按「不存在」处理：释放它占用的用户名/邮箱并断开 OAuth 关联，
 * 这样用户注销之后还能用同一个 GitHub 账号重新注册。
 */
export async function findOrCreateOAuthUser(db: Db, profile: OAuthProfile): Promise<UserRecord> {
  const linked = await db
    .select({ user_id: schema.oauthAccounts.user_id })
    .from(schema.oauthAccounts)
    .where(
      and(
        eq(schema.oauthAccounts.provider, profile.provider),
        eq(schema.oauthAccounts.provider_account_id, profile.providerAccountId),
      ),
    )
    .limit(1);

  let staleLinkUserId: string | null = null;
  if (linked[0]) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, linked[0].user_id)).limit(1);
    if (user && !(await releaseIdentityIfDeletionDone(db, user))) return user;
    if (user) staleLinkUserId = user.id;
  }

  let user: UserRecord | null = null;
  if (profile.email) {
    const email = profile.email.toLowerCase();
    const [byEmail] = await db
      .select()
      .from(schema.users)
      .where(eq(sql`lower(${schema.users.email})`, email))
      .limit(1);
    if (byEmail && !(await releaseIdentityIfDeletionDone(db, byEmail))) {
      user = byEmail;
    }
  }

  if (staleLinkUserId) {
    await releaseDeletedIdentity(db, staleLinkUserId);
    // 断开指向已注销账号的关联，否则每次登录都会再建一个新号。
    await db
      .delete(schema.oauthAccounts)
      .where(
        and(
          eq(schema.oauthAccounts.provider, profile.provider),
          eq(schema.oauthAccounts.provider_account_id, profile.providerAccountId),
          eq(schema.oauthAccounts.user_id, staleLinkUserId),
        ),
      );
  }

  if (!user) {
    const username = await uniqueUsername(db, sanitizeUsername(profile.username));
    const [created] = await db
      .insert(schema.users)
      .values({
        username,
        email: profile.email ?? `${profile.provider}-${profile.providerAccountId}@users.noreply`,
        display_name: profile.displayName ?? profile.username,
        avatar_path: profile.avatarUrl,
        state: 'active',
      })
      .returning();
    if (!created) throw errors.internal(undefined, 'OAuth 用户创建失败');
    user = created;
  }

  await db
    .insert(schema.oauthAccounts)
    .values({
      provider: profile.provider,
      provider_account_id: profile.providerAccountId,
      user_id: user.id,
    })
    .onConflictDoNothing();

  return user;
}

/**
 * 把第三方账号绑定到当前登录用户（控制台「绑定 GitHub」）。
 * - 该 provider 账号已经被别人绑了 → 冲突；
 * - 已经绑给本人 → 幂等成功。
 */
export async function linkOAuthAccount(
  db: Db,
  userId: string,
  provider: string,
  providerAccountId: string,
): Promise<void> {
  const links = await db
    .select({ user_id: schema.oauthAccounts.user_id })
    .from(schema.oauthAccounts)
    .where(
      and(
        eq(schema.oauthAccounts.provider, provider),
        eq(schema.oauthAccounts.provider_account_id, providerAccountId),
      ),
    )
    .limit(1);
  if (links[0]) {
    if (links[0].user_id === userId) return; // 已经绑给自己
    throw errors.conflict('这个 GitHub 账号已经绑定到其他用户了', { field: 'providerAccountId' });
  }
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) throw errors.notFound('用户不存在');
  await db
    .insert(schema.oauthAccounts)
    .values({ provider, provider_account_id: providerAccountId, user_id: userId })
    .onConflictDoNothing();
}

/** 某用户绑定过的第三方登录来源（provider 名列表）。 */
export async function listOAuthProviders(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ provider: schema.oauthAccounts.provider })
    .from(schema.oauthAccounts)
    .where(eq(schema.oauthAccounts.user_id, userId));
  return rows.map((row) => row.provider);
}

/**
 * 解绑第三方登录（如 GitHub）。
 *
 * 护栏：没设置过密码的账号不能解绑 —— 该用户平时只靠 GitHub 登录，
 * 解绑后就再也没有任何登录方式。先在「账号安全」创建密码再解绑。
 * 没绑过 = 幂等成功。
 */
export async function unlinkOAuthAccount(db: Db, userId: string, provider: string): Promise<void> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user || user.state === 'deleted') throw errors.notFound('用户不存在');

  const links = await db
    .select({ id: schema.oauthAccounts.id })
    .from(schema.oauthAccounts)
    .where(and(eq(schema.oauthAccounts.user_id, userId), eq(schema.oauthAccounts.provider, provider)))
    .limit(1);
  const link = links[0];
  if (!link) return; // 没绑过

  if (!user.password_hash) {
    throw errors.forbidden('解绑前请先在「账号安全」创建密码，否则你将没有任何登录方式');
  }
  await db.delete(schema.oauthAccounts).where(eq(schema.oauthAccounts.id, link.id));
}

function sanitizeUsername(username: string): string {
  const cleaned = username.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20);
  return cleaned || `user${Math.random().toString(36).slice(2, 8)}`;
}

async function uniqueUsername(db: Db, base: string): Promise<string> {
  let candidate = base;
  for (let i = 0; i < 10; i++) {
    const [row] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.username, candidate))
      .limit(1);
    if (!row) return candidate;
    candidate = `${base.slice(0, 17)}${Math.random().toString(36).slice(2, 5)}`;
  }
  return `${base.slice(0, 14)}${Date.now().toString(36)}`;
}
