import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import { createApiKey, createSession, hashPassword } from '@ycomm/identity';
import { getEnv, hashToken } from '@ycomm/kernel';
import { errorHandler } from '../error-handler';
import { authRoutes } from './auth';

/**
 * 登录设备管理三个接口的 HTTP 契约测试。
 *
 * 通过 `globalThis` 预置 `getDb()` 的全局句柄（见 packages/db/src/client.ts
 * 的 GLOBAL_HANDLE_KEY），让路由跑在同一块内存 PGlite 上；不用生产数据库。
 */

let handle: DatabaseHandle;
let app: Hono;
let cookieName = '';

beforeAll(async () => {
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
    'packages',
    'db',
    'migrations',
  );
  handle = await createInMemoryDb({ migrationsFolder });
  await handle.runMigrations();
  // 与 packages/db/src/client.ts 的 GLOBAL_HANDLE_KEY 保持一致。
  (globalThis as unknown as Record<string, unknown>).__ycomm_db_handle__ = Promise.resolve(handle);

  cookieName = getEnv().SESSION_COOKIE_NAME;
  app = new Hono();
  app.onError(errorHandler);
  app.route('/api/auth', authRoutes());
});

afterAll(async () => {
  await handle.close();
});

afterEach(async () => {
  for (const table of [schema.auditLogs, schema.apiKeys, schema.sessions, schema.users]) {
    await handle.db.delete(table);
  }
});

async function seedUser(username: string, role: 'member' | 'owner' = 'member'): Promise<string> {
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

interface SeededSession {
  id: string;
  rawToken: string;
  cookie: Record<string, string>;
}

async function seedSession(userId: string, options: { expiresAt?: Date; revokedAt?: Date | null } = {}): Promise<SeededSession> {
  const created = await createSession(handle.db, {
    userId,
    ip: '203.0.113.7',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
    ttlDays: 1,
  });
  const rows = await handle.db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(eq(schema.sessions.token_hash, hashToken(created.rawToken)))
    .limit(1);
  const id = rows[0]?.id;
  if (!id) throw new Error('no session row');
  if (options.expiresAt || options.revokedAt !== undefined) {
    await handle.db
      .update(schema.sessions)
      .set({
        ...(options.expiresAt ? { expires_at: options.expiresAt } : {}),
        ...(options.revokedAt !== undefined ? { revoked_at: options.revokedAt } : {}),
      })
      .where(eq(schema.sessions.id, id));
  }
  return { id, rawToken: created.rawToken, cookie: { cookie: `${cookieName}=${created.rawToken}` } };
}

async function jsonOf(res: Response): Promise<{ ok: boolean; data: unknown; error?: { code: string } }> {
  return res.json() as Promise<{ ok: boolean; data: unknown; error?: { code: string } }>;
}

describe('登录设备管理 API：鉴权门禁', () => {
  it('未登录（无 Cookie）时三个接口都返回 401', async () => {
    const uuid = randomUUID();
    for (const [method, url] of [
      ['GET', '/api/auth/sessions'],
      ['POST', '/api/auth/sessions/revoke-others'],
      ['DELETE', `/api/auth/sessions/${uuid}`],
    ] as const) {
      const res = await app.request(url, { method });
      expect(res.status, `${method} ${url}`).toBe(401);
      expect((await jsonOf(res)).error?.code).toBe('UNAUTHENTICATED');
    }
  });

  it('Bearer API 密钥（站长）访问三个接口都返回 403', async () => {
    const ownerId = await seedUser('key-owner', 'owner');
    const created = await createApiKey(handle.db, { id: ownerId, role: 'owner' }, { name: 'CI 测试密钥' });
    const headers = { authorization: `Bearer ${created.key}` };
    const uuid = randomUUID();
    for (const [method, url] of [
      ['GET', '/api/auth/sessions'],
      ['POST', '/api/auth/sessions/revoke-others'],
      ['DELETE', `/api/auth/sessions/${uuid}`],
    ] as const) {
      const res = await app.request(url, { method, headers });
      expect(res.status, `${method} ${url}`).toBe(403);
      expect((await jsonOf(res)).error?.code).toBe('FORBIDDEN');
    }
  });
});

describe('登录设备管理 API：GET /api/auth/sessions', () => {
  it('只返回本人有效会话，当前会话排第一且标记 isCurrent，不泄漏凭据', async () => {
    const userA = await seedUser('list-a');
    const userB = await seedUser('list-b');
    const current = await seedSession(userA);
    const other = await seedSession(userA);
    await seedSession(userA, { revokedAt: new Date() });
    await seedSession(userA, { expiresAt: new Date(Date.now() - 1000) });
    await seedSession(userB);

    const res = await app.request('/api/auth/sessions', { headers: current.cookie });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ok).toBe(true);
    const sessions = (body.data as { sessions: Array<Record<string, unknown>> }).sessions;

    expect(sessions.map((s) => s.id)).toEqual([current.id, other.id]);
    expect(sessions[0]?.isCurrent).toBe(true);
    expect(sessions[1]?.isCurrent).toBe(false);
    for (const view of sessions) {
      expect(Object.keys(view).sort()).toEqual(
        ['createdAt', 'device', 'expiresAt', 'id', 'ip', 'isCurrent', 'lastUsedAt'].sort(),
      );
    }
    // 响应体不得出现任何凭据字段
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('token_hash');
    expect(raw).not.toContain('tokenHash');
    expect(raw).not.toContain('rawToken');
    expect(raw).not.toContain(current.rawToken);
  });
});

describe('登录设备管理 API：DELETE /api/auth/sessions/:sessionId', () => {
  it('撤销当前会话返回 409，撤销他人会话返回 404 且不影响对方', async () => {
    const userA = await seedUser('del-a');
    const userB = await seedUser('del-b');
    const currentA = await seedSession(userA);
    const sessionB = await seedSession(userB);

    const self = await app.request(`/api/auth/sessions/${currentA.id}`, {
      method: 'DELETE',
      headers: currentA.cookie,
    });
    expect(self.status).toBe(409);
    expect((await jsonOf(self)).error?.code).toBe('CONFLICT');

    const cross = await app.request(`/api/auth/sessions/${sessionB.id}`, {
      method: 'DELETE',
      headers: currentA.cookie,
    });
    expect(cross.status).toBe(404);
    expect((await jsonOf(cross)).error?.code).toBe('NOT_FOUND');

    // B 的会话不受影响，仍然有效
    const me = await app.request('/api/auth/me', { headers: sessionB.cookie });
    expect(me.status).toBe(200);
  });

  it('撤销成功后目标 Cookie 立即失效；重复撤销与不存在/过期/非法 ID 为 404/400', async () => {
    const userA = await seedUser('del-c');
    const current = await seedSession(userA);
    const target = await seedSession(userA);
    const expired = await seedSession(userA, { expiresAt: new Date(Date.now() - 1000) });

    const ok = await app.request(`/api/auth/sessions/${target.id}`, {
      method: 'DELETE',
      headers: current.cookie,
    });
    expect(ok.status).toBe(200);
    const body = await jsonOf(ok);
    expect(body).toEqual({ ok: true, data: null });

    // 撤销后 REST 立即未登录
    const me = await app.request('/api/auth/me', { headers: target.cookie });
    expect(me.status).toBe(401);

    // 重复撤销
    const again = await app.request(`/api/auth/sessions/${target.id}`, {
      method: 'DELETE',
      headers: current.cookie,
    });
    expect(again.status).toBe(404);

    // 不存在 / 已过期
    for (const id of [randomUUID(), expired.id]) {
      const res = await app.request(`/api/auth/sessions/${id}`, {
        method: 'DELETE',
        headers: current.cookie,
      });
      expect(res.status, id).toBe(404);
    }

    // 非法路径参数
    const bad = await app.request('/api/auth/sessions/not-a-uuid', {
      method: 'DELETE',
      headers: current.cookie,
    });
    expect(bad.status).toBe(400);
    expect((await jsonOf(bad)).error?.code).toBe('VALIDATION_FAILED');
  });
});

describe('登录设备管理 API：POST /api/auth/sessions/revoke-others', () => {
  it('返回准确 revokedCount，保留当前会话，重复调用为 0', async () => {
    const userA = await seedUser('bulk-a');
    const userB = await seedUser('bulk-b');
    const current = await seedSession(userA);
    const other1 = await seedSession(userA);
    const other2 = await seedSession(userA);
    await seedSession(userA, { revokedAt: new Date() });
    await seedSession(userA, { expiresAt: new Date(Date.now() - 1000) });
    const foreign = await seedSession(userB);

    const res = await app.request('/api/auth/sessions/revoke-others', {
      method: 'POST',
      headers: current.cookie,
    });
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ ok: true, data: { revokedCount: 2 } });

    // 当前会话保留，其他本账号会话全部失效，B 不受影响
    expect((await app.request('/api/auth/me', { headers: current.cookie })).status).toBe(200);
    for (const other of [other1, other2]) {
      expect((await app.request('/api/auth/me', { headers: other.cookie })).status).toBe(401);
    }
    expect((await app.request('/api/auth/me', { headers: foreign.cookie })).status).toBe(200);

    // 重复撤销：计数为 0
    const again = await app.request('/api/auth/sessions/revoke-others', {
      method: 'POST',
      headers: current.cookie,
    });
    expect(await jsonOf(again)).toEqual({ ok: true, data: { revokedCount: 0 } });
  });
});

describe('登录设备管理 API：审计', () => {
  it('撤销写审计日志，只记录数量/目标 ID，不记录凭据', async () => {
    const userA = await seedUser('audit-a');
    const current = await seedSession(userA);
    const target = await seedSession(userA);

    await app.request(`/api/auth/sessions/${target.id}`, { method: 'DELETE', headers: current.cookie });
    await app.request('/api/auth/sessions/revoke-others', { method: 'POST', headers: current.cookie });

    const rows = await handle.db.select().from(schema.auditLogs);
    const single = rows.find((row) => row.action === 'auth.session_revoked');
    const bulk = rows.find((row) => row.action === 'auth.other_sessions_revoked');
    expect(single).toBeDefined();
    expect(single?.actor_id).toBe(userA);
    expect(single?.target_id).toBe(target.id);
    expect(bulk).toBeDefined();
    expect(bulk?.actor_id).toBe(userA);
    expect(bulk?.meta).toEqual({ revokedCount: 0 });

    const raw = JSON.stringify(rows);
    expect(raw).not.toContain(current.rawToken);
    expect(raw).not.toContain('token_hash');
  });
});
