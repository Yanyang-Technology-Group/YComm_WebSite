import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import {
  createSession,
  deviceFingerprint,
  hashPassword,
  issueDeviceVerificationToken,
  trustDevice,
} from '@ycomm/identity';
import { getEnv } from '@ycomm/kernel';
import { errorHandler } from '../error-handler';
import { authRoutes } from './auth';
import { forumRoutes } from './forum';

/**
 * 两道新闸门的 HTTP 契约：
 * - A：绑定邮箱注册的账号必须先验证邮箱，否则连论坛列表都读不到；
 * - B：该账号没见过这台设备时，先确认是本人在用。
 *
 * 用论坛的版块列表当「内容接口」的代表：它以前只过资源策略闸门。
 */

let handle: DatabaseHandle;
let app: Hono;
let cookieName = '';

const UA_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

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
  app.route('/api/forum', forumRoutes());
});

afterAll(async () => {
  await handle.close();
});

afterEach(async () => {
  for (const table of [
    schema.auditLogs,
    schema.jobs,
    schema.emailLogs,
    schema.emailTokens,
    schema.trustedDevices,
    schema.sessions,
    schema.oauthAccounts,
    schema.users,
  ]) {
    await handle.db.delete(table);
  }
});

async function seedUser(username: string, state: 'unverified' | 'active' = 'active') {
  const [row] = await handle.db
    .insert(schema.users)
    .values({
      username,
      email: `${username}@example.com`,
      password_hash: await hashPassword('password-1'),
      role: 'member',
      state,
      display_name: username,
    })
    .returning();
  if (!row) throw new Error('no user');
  return row;
}

/** 造一个会话并返回它的 Cookie 头。 */
async function cookieFor(
  userId: string,
  options: { userAgent?: string; deviceHash?: string | null } = {},
): Promise<Record<string, string>> {
  const userAgent = options.userAgent ?? UA_CHROME;
  const created = await createSession(handle.db, {
    userId,
    userAgent,
    deviceHash: options.deviceHash === undefined ? deviceFingerprint(userAgent) : options.deviceHash,
  });
  return { cookie: `${cookieName}=${created.rawToken}` };
}

/** 从排队的邮件里取出确认链接里的 token。 */
async function deviceTokenFromMail(path: string): Promise<string> {
  const jobs = await handle.db.select().from(schema.jobs).where(eq(schema.jobs.kind, 'send_email'));
  for (const job of jobs) {
    const payload = job.payload as { html?: string; text?: string };
    const match = `${payload.html ?? ''}${payload.text ?? ''}`.match(new RegExp(`${path}\\?token=([^&"<>\\s]+)`));
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  throw new Error(`no ${path} token found in queued mail`);
}

async function api(path: string, headers: Record<string, string>, init: RequestInit = {}) {
  const response = await app.request(path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const body = (await response.json().catch(() => ({}))) as { error?: { code?: string }; data?: unknown };
  return { status: response.status, body };
}

describe('闸门 A：未验证邮箱的账号看不到任何内容', () => {
  it('内容接口 403 ACCOUNT_UNVERIFIED，验证相关接口仍然可用', async () => {
    const user = await seedUser('gate-unverified', 'unverified');
    const cookie = await cookieFor(user.id);

    const boards = await api('/api/forum/boards', cookie);
    expect(boards.status).toBe(403);
    expect(boards.body.error?.code).toBe('ACCOUNT_UNVERIFIED');

    // 登录设备列表同样拦着（它不属于验证相关的自助动作）
    expect((await api('/api/auth/trusted-devices', cookie)).status).toBe(403);

    // /me 必须放行，否则前端连「去验证邮箱」都渲染不出来
    const me = await api('/api/auth/me', cookie);
    expect(me.status).toBe(200);
    const data = me.body.data as {
      email: string;
      needsEmailVerification: boolean;
      pendingDevice: boolean;
      verificationGraceEndsAt: string | null;
    };
    expect(data.needsEmailVerification).toBe(true);
    // 这台设备同样还没确认：先验证邮箱，验证完还要确认设备（前端按这个顺序引导）。
    expect(data.pendingDevice).toBe(true);
    expect(data.email).toBe(user.email);
    // 注册满 3 天就自动注销 → 前端要能算出倒计时
    expect(data.verificationGraceEndsAt).toBe(
      new Date(user.created_at.getTime() + 3 * 86400_000).toISOString(),
    );
  });

  it('验证邮箱之后紧接着按新设备处理，确认设备后恢复访问', async () => {
    const user = await seedUser('gate-verify', 'unverified');
    const hash = deviceFingerprint(UA_CHROME) as string;
    const cookie = await cookieFor(user.id, { userAgent: UA_CHROME, deviceHash: hash });
    expect((await api('/api/forum/boards', cookie)).status).toBe(403);

    // 点了邮件里的验证链接 → 账号变 active，但设备仍然没确认过
    await handle.db.update(schema.users).set({ state: 'active' }).where(eq(schema.users.id, user.id));
    const second = await api('/api/forum/boards', cookie);
    expect(second.status).toBe(403);
    expect(second.body.error?.code).toBe('DEVICE_UNVERIFIED');

    // 确认这台设备之后才真正放行
    await issueDeviceVerificationToken(handle.db, user, {
      deviceHash: hash,
      deviceLabel: 'Chrome · Windows',
      ip: '203.0.113.9',
    });
    const token = await deviceTokenFromMail('/verify-device');
    const confirm = await api('/api/auth/verify-device', cookie, {
      method: 'POST',
      body: JSON.stringify({ token }),
      headers: { 'content-type': 'application/json' },
    });
    expect(confirm.status).toBe(200);

    expect((await api('/api/forum/boards', cookie)).status).toBe(200);
  });
});

describe('闸门 B：新设备要先用邮箱确认', () => {
  it('未确认时内容接口 403 DEVICE_UNVERIFIED，确认后放行', async () => {
    const user = await seedUser('gate-device');
    const hash = deviceFingerprint(UA_CHROME) as string;
    const cookie = await cookieFor(user.id, { userAgent: UA_CHROME, deviceHash: hash });

    const blocked = await api('/api/forum/boards', cookie);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error?.code).toBe('DEVICE_UNVERIFIED');

    const me = await api('/api/auth/me', cookie);
    expect(me.status).toBe(200);
    expect((me.body.data as { pendingDevice: boolean }).pendingDevice).toBe(true);

    // 待确认设备也不能看设备列表（白名单只有 me / verify-device / resend-device / logout）
    expect((await api('/api/auth/trusted-devices', cookie)).status).toBe(403);

    // 发确认信（真实登录流程里由 startSession 发），取链接里的 token 确认
    await issueDeviceVerificationToken(handle.db, user, {
      deviceHash: hash,
      deviceLabel: 'Chrome · Windows',
      ip: '203.0.113.9',
    });
    const token = await deviceTokenFromMail('/verify-device');
    const confirm = await api('/api/auth/verify-device', cookie, {
      method: 'POST',
      body: JSON.stringify({ token }),
      headers: { 'content-type': 'application/json' },
    });
    expect(confirm.status).toBe(200);

    // 确认之后同一个会话（同一台设备）就能用了
    expect((await api('/api/forum/boards', cookie)).status).toBe(200);
    const devices = await api('/api/auth/trusted-devices', cookie);
    expect(devices.status).toBe(200);
    expect((devices.body.data as { devices: unknown[] }).devices).toHaveLength(1);
  });

  it('升级前的老会话（没有设备指纹）不会被自己的新闸门拦住', async () => {
    const user = await seedUser('gate-legacy');

    const cookie = await cookieFor(user.id, { userAgent: UA_CHROME, deviceHash: null });

    expect((await api('/api/forum/boards', cookie)).status).toBe(200);
  });

  it('已确认的设备直接放行；撤销后该设备的会话被吊销', async () => {
    const user = await seedUser('gate-trusted');
    const hash = deviceFingerprint(UA_CHROME) as string;
    await trustDevice(handle.db, user.id, hash, 'Chrome · Windows');
    const cookie = await cookieFor(user.id, { userAgent: UA_CHROME, deviceHash: hash });

    expect((await api('/api/forum/boards', cookie)).status).toBe(200);

    const listed = await api('/api/auth/trusted-devices', cookie);
    const data = listed.body.data as { devices: { id: string }[]; currentDeviceTrusted: boolean };
    expect(data.currentDeviceTrusted).toBe(true);
    expect(data.devices).toHaveLength(1);

    const removed = await api(`/api/auth/trusted-devices/${data.devices[0]?.id}`, cookie, { method: 'DELETE' });
    expect(removed.status).toBe(200);

    // 撤销 = 把那台设备踢下线：它的会话已被吊销，/me 回到 401
    expect((await api('/api/auth/me', cookie)).status).toBe(401);
  });

  it('未验证邮箱 + 新设备：先按邮箱验证拦（一次登录只收一封邮件）', async () => {
    const user = await seedUser('gate-both', 'unverified');
    const cookie = await cookieFor(user.id);

    const response = await api('/api/forum/boards', cookie);

    expect(response.body.error?.code).toBe('ACCOUNT_UNVERIFIED');
  });
});
