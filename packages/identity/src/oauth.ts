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
