import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import { hashPassword } from '@ycomm/identity';
import {
  authenticateApiKey,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  touchApiKey,
} from './index';

let handle: DatabaseHandle;
let ownerId = '';
let adminId = '';

beforeAll(async () => {
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations');
  handle = await createInMemoryDb({ migrationsFolder });
  await handle.runMigrations();
});

beforeEach(async () => {
  ownerId = await seedUser('api-owner', 'owner');
  adminId = await seedUser('api-admin', 'admin');
});

afterEach(async () => {
  for (const table of [schema.apiKeys, schema.users]) {
    await handle.db.delete(table);
  }
});

async function seedUser(username: string, role: 'member' | 'admin' | 'owner'): Promise<string> {
  const [row] = await handle.db
    .insert(schema.users)
    .values({
      username,
      email: `${username}@example.com`,
      password_hash: await hashPassword('password-1'),
      role,
      state: 'active',
      display_name: username,
    })
    .returning({ id: schema.users.id });
  if (!row) throw new Error('no user');
  return row.id;
}

describe('api keys', () => {
  it('站长创建密钥：明文只返回一次，库里只有哈希；能用它鉴权', async () => {
    const created = await createApiKey(handle.db, { id: ownerId, role: 'owner' }, { name: 'CI 建卡' });
    expect(created.key.startsWith('ycomm_')).toBe(true);
    expect(created.prefix).toBe(created.key.slice(0, 14));

    // 列表里不会再出现明文
    const list = await listApiKeys(handle.db);
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(created.key);

    const auth = await authenticateApiKey(handle.db, created.key);
    expect(auth?.user.id).toBe(ownerId);
    expect(auth?.readOnly).toBe(false);
    expect(auth?.lastUsedAt).toBeNull();
  });

  it('非站长不能创建密钥', async () => {
    await expect(createApiKey(handle.db, { id: adminId, role: 'admin' }, { name: 'x' })).rejects.toThrow();
  });

  it('只读 / 过期 / 撤销三种情况', async () => {
    const readOnly = await createApiKey(handle.db, { id: ownerId, role: 'owner' }, { name: '只读', readOnly: true });
    expect((await authenticateApiKey(handle.db, readOnly.key))?.readOnly).toBe(true);

    const expired = await createApiKey(handle.db, { id: ownerId, role: 'owner' }, { name: '过期', expiresInDays: 1 });
    await handle.db
      .update(schema.apiKeys)
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where(eq(schema.apiKeys.id, expired.id));
    expect(await authenticateApiKey(handle.db, expired.key)).toBeNull();

    const revoked = await createApiKey(handle.db, { id: ownerId, role: 'owner' }, { name: '待撤销' });
    await revokeApiKey(handle.db, revoked.id);
    expect(await authenticateApiKey(handle.db, revoked.key)).toBeNull();
    // 重复撤销是幂等的
    await expect(revokeApiKey(handle.db, revoked.id)).resolves.toBeUndefined();
  });

  it('乱七八糟的字符串 / 未撤销但用户已不是 owner 的密钥都无效', async () => {
    expect(await authenticateApiKey(handle.db, 'not-a-key')).toBeNull();
    expect(await authenticateApiKey(handle.db, 'ycomm_不存在')).toBeNull();

    const created = await createApiKey(handle.db, { id: ownerId, role: 'owner' }, { name: '转让后失效' });
    expect(await authenticateApiKey(handle.db, created.key)).not.toBeNull();

    // 站长转让（直接把角色改掉）：旧密钥立刻失效
    await handle.db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, ownerId));
    expect(await authenticateApiKey(handle.db, created.key)).toBeNull();
  });

  it('touchApiKey 一分钟内不重复写库', async () => {
    const created = await createApiKey(handle.db, { id: ownerId, role: 'owner' }, { name: '节流' });
    // 刚写过的（lastUsedAt 为 null）第一次会写
    await touchApiKey(handle.db, created.id, null);
    const after = (await listApiKeys(handle.db))[0]?.lastUsedAt;
    expect(after).not.toBeNull();
    // 一分钟内不再更新
    await touchApiKey(handle.db, created.id, new Date());
    expect((await listApiKeys(handle.db))[0]?.lastUsedAt).toBe(after);
  });
});