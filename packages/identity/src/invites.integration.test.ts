import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import { hashPassword } from '@ycomm/identity';
import {
  adminCreateInviteCode,
  bindInviteCode,
  getInviteBinding,
  unbindInviteCode,
  updateInviteCodeMaxUses,
} from './index';

let handle: DatabaseHandle;
let adminId = '';
let memberId = '';

beforeEach(async () => {
  adminId = await seedUser('invite-admin', 'admin');
  memberId = await seedUser('invite-member', 'member');
});

beforeAll(async () => {
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations');
  handle = await createInMemoryDb({ migrationsFolder });
  await handle.runMigrations();
});

afterEach(async () => {
  for (const table of [
    schema.inviteCodeUses,
    schema.inviteCodes,
    schema.users,
  ]) {
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

describe('invite code management', () => {
  it('管理员改数量：不能小于已绑定数；改大之后还能继续绑', async () => {
    const invite = await adminCreateInviteCode(handle.db, { name: '测试码', code: 'TESTCODE', maxUses: 1, createdBy: adminId });
    await bindInviteCode(handle.db, memberId, invite.code);

    // 已绑 1 个：改成 0 / 负数要拒绝，改成 1（等于已用）可以。
    await expect(updateInviteCodeMaxUses(handle.db, invite.id, 0)).rejects.toThrow();
    const same = await updateInviteCodeMaxUses(handle.db, invite.id, 1);
    expect(same.usedCount).toBe(1);
    expect(same.maxUses).toBe(1);

    // 改成 3 → 新用户还能继续绑定。
    const widened = await updateInviteCodeMaxUses(handle.db, invite.id, 3);
    expect(widened.maxUses).toBe(3);

    const second = await seedUser('invite-member-2', 'member');
    await bindInviteCode(handle.db, second, invite.code);
    expect((await updateInviteCodeMaxUses(handle.db, invite.id, 3)).usedCount).toBe(2);
  });

  it('管理员解绑玩家的注册码：绑定消失、名额还回去、可重新绑定', async () => {
    const invite = await adminCreateInviteCode(handle.db, { name: '解绑码', code: 'UNBINDME', maxUses: 1, createdBy: adminId });
    await bindInviteCode(handle.db, memberId, invite.code);
    expect((await getInviteBinding(handle.db, memberId)).bound).toBe(true);

    const result = await unbindInviteCode(handle.db, memberId);
    expect(result.code).toBe('UNBINDME');
    expect((await getInviteBinding(handle.db, memberId)).bound).toBe(false);

    // 名额回到注册码上：另一个人可以占用。
    const other = await seedUser('invite-member-3', 'member');
    await bindInviteCode(handle.db, other, invite.code);

    // 没绑定时解绑是幂等的（返回 null，不报错）。
    expect((await unbindInviteCode(handle.db, memberId)).code).toBeNull();
  });
});