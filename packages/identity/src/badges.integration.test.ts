import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import { hashPassword } from '@ycomm/identity';
import {
  assignBadge,
  createBadge,
  deleteBadge,
  listBadges,
  listBadgesForUsers,
  listUserBadges,
  revokeBadge,
} from './index';

let handle: DatabaseHandle;
let adminId = '';
let userId = '';

beforeEach(async () => {
  adminId = await seedUser('badge-admin');
  userId = await seedUser('badge-target');
});

beforeAll(async () => {
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations');
  handle = await createInMemoryDb({ migrationsFolder });
  await handle.runMigrations();
});

afterEach(async () => {
  for (const table of [schema.userBadges, schema.badges, schema.users]) {
    await handle.db.delete(table);
  }
});

async function seedUser(username: string): Promise<string> {
  const [row] = await handle.db
    .insert(schema.users)
    .values({
      username,
      email: `${username}@example.com`,
      password_hash: await hashPassword('password-1'),
      role: 'member',
      state: 'active',
      display_name: username,
    })
    .returning({ id: schema.users.id });
  if (!row) throw new Error('no user');
  return row.id;
}

describe('badges', () => {
  it('建徽章 → 分配多个 → 查询 → 收回', async () => {
    const gold = await createBadge(
      handle.db,
      { name: '元老', colorFrom: '#ffd700', colorTo: '#b8860b' },
      adminId,
    );
    const angel = await createBadge(handle.db, { name: '大善人' }, adminId);

    await assignBadge(handle.db, userId, gold.id, adminId);
    await assignBadge(handle.db, userId, angel.id, adminId);

    expect(await listBadges(handle.db)).toHaveLength(2);

    const mine = await listUserBadges(handle.db, userId);
    expect(mine.map((badge) => badge.name).sort()).toEqual(['元老', '大善人']);
    expect(mine[0]?.colorFrom).toBe('#ffd700');

    // 批量查询（帖子作者集合）。
    const map = await listBadgesForUsers(handle.db, [userId, adminId]);
    expect(map.get(userId)?.map((badge) => badge.name).sort()).toEqual(['元老', '大善人']);
    expect(map.get(adminId)).toBeUndefined();

    // 收回一个。
    await revokeBadge(handle.db, userId, angel.id);
    expect((await listUserBadges(handle.db, userId)).map((badge) => badge.name)).toEqual(['元老']);
  });

  it('删徽章定义后分配记录级联清除', async () => {
    const badge = await createBadge(handle.db, { name: '临时' }, adminId);
    await assignBadge(handle.db, userId, badge.id, adminId);
    expect(await listUserBadges(handle.db, userId)).toHaveLength(1);

    await deleteBadge(handle.db, badge.id);
    expect(await listUserBadges(handle.db, userId)).toHaveLength(0);
    expect(await listBadges(handle.db)).toHaveLength(0);
  });
});