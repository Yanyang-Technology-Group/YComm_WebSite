import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import { findOrCreateOAuthUser, linkOAuthAccount, listOAuthProviders } from './index';

/**
 * GitHub 等第三方绑定的归属规则。核心回归点：一个账号注销之后，
 * 它占着的 GitHub 必须能让位给新账号 —— 历史数据里注销没有断开关联的行
 * 曾经让同一个 GitHub 永远绑不上任何别的账号。
 */

let handle: DatabaseHandle;

beforeAll(async () => {
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations');
  handle = await createInMemoryDb({ migrationsFolder });
  await handle.runMigrations();
});

afterEach(async () => {
  for (const table of [schema.oauthAccounts, schema.sessions, schema.emailTokens, schema.users]) {
    await handle.db.delete(table);
  }
});

interface SeedUserOptions {
  state?: 'active' | 'deleting' | 'deleted' | 'banned';
  deletedAt?: Date | null;
  email?: string;
}

async function seedUser(username: string, options: SeedUserOptions = {}): Promise<string> {
  const [row] = await handle.db
    .insert(schema.users)
    .values({
      username,
      email: options.email ?? `${username}@example.com`,
      password_hash: 'not-a-real-hash',
      role: 'member',
      state: options.state ?? 'active',
      display_name: username,
      deleted_at: options.deletedAt ?? null,
    })
    .returning({ id: schema.users.id });
  if (!row) throw new Error('no user');
  return row.id;
}

/** 直接落一条绑定行，模拟「注销时没断开」的历史数据。 */
async function seedLink(provider: string, accountId: string, userId: string): Promise<void> {
  await handle.db
    .insert(schema.oauthAccounts)
    .values({ provider, provider_account_id: accountId, user_id: userId });
}

async function holdersOf(provider: string, accountId: string): Promise<string[]> {
  const rows = await handle.db
    .select({ user_id: schema.oauthAccounts.user_id })
    .from(schema.oauthAccounts)
    .where(
      and(
        eq(schema.oauthAccounts.provider, provider),
        eq(schema.oauthAccounts.provider_account_id, accountId),
      ),
    );
  return rows.map((row) => row.user_id);
}

async function userRow(userId: string) {
  const rows = await handle.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return rows[0] ?? null;
}

describe('绑定 GitHub：归属与让位', () => {
  it('已注销账号占着的 GitHub 会先让位，再绑到新账号', async () => {
    const oldUserId = await seedUser('gh-old-owner', { state: 'deleted', deletedAt: new Date() });
    await seedLink('github', '167761826', oldUserId);
    const newUserId = await seedUser('gh-new-owner');

    await linkOAuthAccount(handle.db, newUserId, 'github', '167761826');

    expect(await holdersOf('github', '167761826')).toEqual([newUserId]);
    // 顺手把老账号残留的用户名/邮箱也释放了（它可以重新注册同名账号）
    const old = await userRow(oldUserId);
    expect(old?.state).toBe('deleted');
    expect(old?.username.startsWith('deleted_')).toBe(true);
    expect(await listOAuthProviders(handle.db, newUserId)).toEqual(['github']);
  });

  it('占用者是有效账号 → 冲突，不抢别人的绑定', async () => {
    const otherUserId = await seedUser('gh-active-owner');
    await seedLink('github', 'acc-active', otherUserId);
    const newUserId = await seedUser('gh-second');

    await expect(linkOAuthAccount(handle.db, newUserId, 'github', 'acc-active')).rejects.toMatchObject({
      code: errors.conflict().code,
    });
    expect(await holdersOf('github', 'acc-active')).toEqual([otherUserId]);
  });

  it('冷静期内的账号仍然占着 GitHub → 冲突并说明原因', async () => {
    const deletingUserId = await seedUser('gh-deleting', { state: 'deleting', deletedAt: new Date() });
    await seedLink('github', 'acc-deleting', deletingUserId);
    const newUserId = await seedUser('gh-impatient');

    await expect(linkOAuthAccount(handle.db, newUserId, 'github', 'acc-deleting')).rejects.toMatchObject({
      code: errors.conflict().code,
      message: expect.stringContaining('冷静期'),
    });
    expect(await holdersOf('github', 'acc-deleting')).toEqual([deletingUserId]);
  });

  it('绑给本人是幂等的，不会留下重复行', async () => {
    const userId = await seedUser('gh-self');
    await linkOAuthAccount(handle.db, userId, 'github', 'acc-self');
    await linkOAuthAccount(handle.db, userId, 'github', 'acc-self');

    expect(await holdersOf('github', 'acc-self')).toEqual([userId]);
  });

  it('注销后同一个 GitHub 重新登录会建新账号，不会回到已注销账号', async () => {
    const oldUserId = await seedUser('gh-reborn', { state: 'deleted', deletedAt: new Date() });
    await seedLink('github', 'acc-reborn', oldUserId);

    const user = await findOrCreateOAuthUser(handle.db, {
      provider: 'github',
      providerAccountId: 'acc-reborn',
      username: 'gh-reborn',
      email: null,
      displayName: null,
      avatarUrl: null,
    });

    expect(user.id).not.toBe(oldUserId);
    expect(user.state).toBe('active');
    expect(await holdersOf('github', 'acc-reborn')).toEqual([user.id]);
  });
});
