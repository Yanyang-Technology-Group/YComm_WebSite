import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import { hashPassword } from '@ycomm/identity';
import { hashToken } from '@ycomm/kernel';
import {
  createSession,
  describeDevice,
  listActiveSessionsForUser,
  revokeOtherSessionForUser,
  revokeOtherSessionsForUser,
  touchSessionIfStale,
} from './index';

let handle: DatabaseHandle;

beforeAll(async () => {
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations');
  handle = await createInMemoryDb({ migrationsFolder });
  await handle.runMigrations();
});

afterEach(async () => {
  for (const table of [schema.sessions, schema.users]) {
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

interface SeedSessionOptions {
  expiresAt?: Date;
  revokedAt?: Date | null;
  lastUsedAt?: Date | null;
  createdAt?: Date;
  userAgent?: string | null;
  ip?: string | null;
}

/** 直接落一行 sessions，方便控制过期/撤销/最近使用时间。 */
async function seedSession(userId: string, token: string, options: SeedSessionOptions = {}): Promise<string> {
  const [row] = await handle.db
    .insert(schema.sessions)
    .values({
      token_hash: hashToken(token),
      user_id: userId,
      ip: options.ip ?? null,
      user_agent: options.userAgent ?? null,
      created_at: options.createdAt ?? new Date(),
      expires_at: options.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
      last_used_at: options.lastUsedAt ?? null,
      revoked_at: options.revokedAt ?? null,
    })
    .returning({ id: schema.sessions.id });
  if (!row) throw new Error('no session');
  return row.id;
}

async function sessionRow(sessionId: string) {
  const rows = await handle.db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1);
  return rows[0] ?? null;
}

describe('sessions', () => {
  it('登录（创建会话）会写入最后登录时间 —— 管理后台不再显示「未记录」', async () => {
    const userId = await seedUser('login-time');

    const before = await handle.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    expect(before[0]?.last_seen_at).toBeNull();

    await createSession(handle.db, { userId, ip: '127.0.0.1', userAgent: 'vitest' });

    const after = await handle.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    expect(after[0]?.last_seen_at).toBeInstanceOf(Date);
  });
});

describe('登录设备管理：会话列表', () => {
  it('只列本账号有效会话，当前会话排第一，过期/已撤销/他人会话不出现', async () => {
    const userA = await seedUser('device-a');
    const userB = await seedUser('device-b');

    const currentA = await seedSession(userA, 'tok-a-current', {
      lastUsedAt: new Date(Date.now() - 60_000),
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
    });
    const olderA = await seedSession(userA, 'tok-a-older', {
      lastUsedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      userAgent: 'YCommFlutter/Android',
      ip: '203.0.113.9',
    });
    const newestOtherA = await seedSession(userA, 'tok-a-newer', {
      lastUsedAt: new Date(Date.now() - 30 * 60 * 1000),
      userAgent: 'Mozilla/5.0 (iPhone) Safari/17.0',
    });
    await seedSession(userA, 'tok-a-revoked', { revokedAt: new Date() });
    await seedSession(userA, 'tok-a-expired', { expiresAt: new Date(Date.now() - 1000) });
    await seedSession(userB, 'tok-b-1', { userAgent: 'Mozilla/5.0 (X11; Linux) Firefox/128.0' });

    const listA = await listActiveSessionsForUser(handle.db, userA, currentA);

    expect(listA.map((view) => view.id)).toEqual([currentA, newestOtherA, olderA]);
    expect(listA[0]?.isCurrent).toBe(true);
    expect(listA.slice(1).every((view) => view.isCurrent === false)).toBe(true);
    // 未知 IP 归一为 null，已知 IP 原样保留。
    expect(listA.find((view) => view.id === olderA)?.ip).toBe('203.0.113.9');
    expect(listA.find((view) => view.id === currentA)?.ip).toBeNull();

    // 两个账号互不可见：B 的列表只有 B 自己的会话。
    const listB = await listActiveSessionsForUser(handle.db, userB, 'tok-b-nope');
    expect(listB.map((view) => view.id)).toHaveLength(1);
    expect(listA.some((view) => view.id === listB[0]!.id)).toBe(false);
  });

  it('DTO 只含公开字段：无 token_hash/rawToken，时间为 ISO 8601', async () => {
    const userId = await seedUser('device-dto');
    const sessionId = await seedSession(userId, 'tok-dto', { ip: '198.51.100.4', userAgent: 'curl/8.0' });

    const [view] = await listActiveSessionsForUser(handle.db, userId, sessionId);

    expect(view).toBeDefined();
    expect(Object.keys(view!).sort()).toEqual(
      ['createdAt', 'device', 'expiresAt', 'id', 'ip', 'isCurrent', 'lastUsedAt'].sort(),
    );
    expect(view!.createdAt).toBe(new Date(view!.createdAt).toISOString());
    expect(view!.expiresAt).toBe(new Date(view!.expiresAt).toISOString());
    expect(JSON.stringify(view)).not.toContain('token');
    const row = await sessionRow(sessionId);
    expect(row?.token_hash).toBeDefined(); // 库里确实有 token_hash，但绝不外泄
  });

  it('设备名称由 User-Agent 展示推断：浏览器 / Flutter 客户端 / 未知设备', async () => {
    expect(describeDevice('YCommFlutter/Android')).toBe('YComm 客户端 · Android');
    expect(describeDevice('YCommFlutter/iOS')).toBe('YComm 客户端 · iOS');
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit Chrome/120.0')).toContain('Chrome');
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit Chrome/120.0')).toContain('Windows');
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/17.0')).toContain('Safari');
    expect(describeDevice('')).toBe('未知设备');
    expect(describeDevice(null)).toBe('未知设备');
    expect(describeDevice('!!!###???')).toBe('未知设备');
    // 展示名称必须短，不能把整段 UA 泄漏进列表
    expect(describeDevice('Mozilla/5.0 ' + 'x'.repeat(300)).length).toBeLessThanOrEqual(80);
  });
});

describe('登录设备管理：撤销其他会话', () => {
  it('只能撤销本账号的其他有效会话；当前/他人/已失效会话都不命中', async () => {
    const userA = await seedUser('revoke-a');
    const userB = await seedUser('revoke-b');

    const currentA = await seedSession(userA, 'tok-a-cur');
    const otherA = await seedSession(userA, 'tok-a-other');
    const revokedA = await seedSession(userA, 'tok-a-rev', { revokedAt: new Date() });
    const expiredA = await seedSession(userA, 'tok-a-exp', { expiresAt: new Date(Date.now() - 1000) });
    const otherB = await seedSession(userB, 'tok-b-other');

    // 当前会话不通过远程撤销接口退出
    expect(await revokeOtherSessionForUser(handle.db, userA, currentA, currentA)).toBe(false);
    expect((await sessionRow(currentA))?.revoked_at).toBeNull();

    // 不能撤销别人的会话（两账号隔离）
    expect(await revokeOtherSessionForUser(handle.db, userA, currentA, otherB)).toBe(false);
    expect((await sessionRow(otherB))?.revoked_at).toBeNull();

    // 重复撤销 / 失效目标：一律不命中
    expect(await revokeOtherSessionForUser(handle.db, userA, currentA, revokedA)).toBe(false);
    expect(await revokeOtherSessionForUser(handle.db, userA, currentA, expiredA)).toBe(false);

    // 正常撤销本账号其他会话
    expect(await revokeOtherSessionForUser(handle.db, userA, currentA, otherA)).toBe(true);
    expect((await sessionRow(otherA))?.revoked_at).toBeInstanceOf(Date);
    // 重复撤销同一个目标返回 false
    expect(await revokeOtherSessionForUser(handle.db, userA, currentA, otherA)).toBe(false);
  });

  it('批量撤销只影响本账号其他有效会话，返回数量；重复调用计数为 0', async () => {
    const userA = await seedUser('bulk-a');
    const userB = await seedUser('bulk-b');

    const currentA = await seedSession(userA, 'tok-a-cur');
    const other1 = await seedSession(userA, 'tok-a-o1');
    const other2 = await seedSession(userA, 'tok-a-o2');
    await seedSession(userA, 'tok-a-rev', { revokedAt: new Date() });
    await seedSession(userA, 'tok-a-exp', { expiresAt: new Date(Date.now() - 1000) });
    const otherB = await seedSession(userB, 'tok-b-o');

    expect(await revokeOtherSessionsForUser(handle.db, userA, currentA)).toBe(2);
    expect((await sessionRow(currentA))?.revoked_at).toBeNull();
    expect((await sessionRow(other1))?.revoked_at).toBeInstanceOf(Date);
    expect((await sessionRow(other2))?.revoked_at).toBeInstanceOf(Date);
    expect((await sessionRow(otherB))?.revoked_at).toBeNull();

    // 重复批量撤销：计数为 0
    expect(await revokeOtherSessionsForUser(handle.db, userA, currentA)).toBe(0);
  });
});

describe('登录设备管理：最近使用时间', () => {
  it('五分钟内不重复更新；超过五分钟或为空时才写入', async () => {
    const userId = await seedUser('touch-a');

    const freshId = await seedSession(userId, 'tok-touch-fresh', { lastUsedAt: new Date(Date.now() - 60_000) });
    const freshBefore = (await sessionRow(freshId))?.last_used_at;
    await touchSessionIfStale(handle.db, freshId, freshBefore ?? null);
    expect((await sessionRow(freshId))?.last_used_at?.getTime()).toBe(freshBefore?.getTime());

    const staleId = await seedSession(userId, 'tok-touch-stale', {
      lastUsedAt: new Date(Date.now() - 6 * 60 * 1000),
    });
    const staleBefore = (await sessionRow(staleId))?.last_used_at;
    await touchSessionIfStale(handle.db, staleId, staleBefore ?? null);
    const staleAfter = (await sessionRow(staleId))?.last_used_at;
    expect(staleAfter!.getTime()).toBeGreaterThan(staleBefore!.getTime());

    const emptyId = await seedSession(userId, 'tok-touch-empty', { lastUsedAt: null });
    await touchSessionIfStale(handle.db, emptyId, null);
    expect((await sessionRow(emptyId))?.last_used_at).toBeInstanceOf(Date);
  });

  it('带时间条件的更新：调用方持有过期读数时不会把新的 last_used_at 改旧', async () => {
    const userId = await seedUser('touch-race');
    const sessionId = await seedSession(userId, 'tok-touch-race', {
      lastUsedAt: new Date(Date.now() - 10 * 60 * 1000),
    });

    // 模拟两次请求都拿到同一份「陈旧」读数：第一次写入成功，第二次被 WHERE 条件挡住。
    const staleReading = (await sessionRow(sessionId))?.last_used_at ?? null;
    await touchSessionIfStale(handle.db, sessionId, staleReading);
    const firstTouch = (await sessionRow(sessionId))?.last_used_at;
    expect(firstTouch).toBeInstanceOf(Date);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await touchSessionIfStale(handle.db, sessionId, staleReading);
    expect((await sessionRow(sessionId))?.last_used_at?.getTime()).toBe(firstTouch?.getTime());
  });
});