import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import {
  hoursUntilPurge,
  issueDeviceVerificationToken,
  startSession,
  sweepUnverifiedAccounts,
  trustDevice,
  deviceFingerprint,
} from './index';

/**
 * 未验证邮箱账号的自动清理：每 6 小时提醒一次，注册满 3 天自动注销。
 *
 * 邮件发送本身是队列里的作业（`send_email`），这里断言的是「排了哪封邮件、
 * 邮件里写了什么」以及「到期的账号有没有干净地让位」。
 */

let handle: DatabaseHandle;

beforeAll(async () => {
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations');
  handle = await createInMemoryDb({ migrationsFolder });
  await handle.runMigrations();
});

afterEach(async () => {
  for (const table of [
    schema.jobs,
    schema.emailLogs,
    schema.emailTokens,
    schema.sessions,
    schema.oauthAccounts,
    schema.trustedDevices,
    schema.users,
  ]) {
    await handle.db.delete(table);
  }
});

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-09-25T12:00:00.000Z');

interface SeedOptions {
  createdAt?: Date;
  email?: string;
  state?: 'unverified' | 'active';
}

async function seedUser(username: string, options: SeedOptions = {}) {
  const [row] = await handle.db
    .insert(schema.users)
    .values({
      username,
      email: options.email ?? `${username}@example.com`,
      state: options.state ?? 'unverified',
      role: 'member',
      created_at: options.createdAt ?? now,
    })
    .returning();
  if (!row) throw new Error('no user');
  return row;
}

/** 模拟「上一封验证邮件是什么时候发的」：清理任务只看 email_logs。 */
async function seedMailLog(email: string, template: string, createdAt: Date): Promise<void> {
  await handle.db.insert(schema.emailLogs).values({
    to_email: email,
    template,
    subject: 'x',
    status: 'sent',
    created_at: createdAt,
  });
}

interface QueuedMail {
  to?: string;
  template?: string;
  subject?: string;
  text?: string;
  html?: string;
}

async function queuedMails(): Promise<QueuedMail[]> {
  const jobs = await handle.db.select().from(schema.jobs).where(eq(schema.jobs.kind, 'send_email'));
  return jobs.map((job) => job.payload as QueuedMail);
}

describe('未验证邮箱账号的定期清理', () => {
  it('每 6 小时提醒一次，提醒信里写明还剩多久会被自动注销', async () => {
    const user = await seedUser('sweep-remind', { createdAt: new Date(now.getTime() - 5 * HOUR) });
    // 注册那封邮件是 7 小时前发的 → 已经过了 6 小时节流窗口。
    await seedMailLog(user.email, 'verify_email', new Date(now.getTime() - 7 * HOUR));

    const result = await sweepUnverifiedAccounts(handle.db, { now });

    expect(result).toEqual({ scanned: 1, reminded: 1, purged: 0 });
    const mails = await queuedMails();
    expect(mails).toHaveLength(1);
    expect(mails[0]?.template).toBe('verify_email_reminder');
    expect(mails[0]?.to).toBe(user.email);
    // 3 天宽限期 - 已过 5 小时 = 67 小时 → 「2 天 19 小时」
    expect(mails[0]?.subject).toContain('2 天 19 小时');
    expect(mails[0]?.text).toContain('2 天 19 小时后还未验证邮箱将自动注销你的账号');
    expect(mails[0]?.html).toContain('自动注销');
    // 提醒链接仍然是邮箱验证令牌（点进去走同一个验证接口）。
    const tokens = await handle.db.select().from(schema.emailTokens).where(eq(schema.emailTokens.user_id, user.id));
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.purpose).toBe('verify_email');
  });

  it('距上一封不满 6 小时就不再发（不会被每半小时一轮的巡检轰炸）', async () => {
    const user = await seedUser('sweep-throttle', { createdAt: new Date(now.getTime() - 5 * HOUR) });
    await seedMailLog(user.email, 'verify_email', new Date(now.getTime() - 1 * HOUR));

    const result = await sweepUnverifiedAccounts(handle.db, { now });

    expect(result.reminded).toBe(0);
    expect(await queuedMails()).toHaveLength(0);
  });

  it('注册满 3 天仍未验证 → 自动注销：用户名/邮箱让位、会话吊销、第三方绑定断开', async () => {
    const user = await seedUser('sweep-expired', {
      createdAt: new Date(now.getTime() - 4 * 24 * HOUR),
      email: 'expired@example.com',
    });
    await handle.db.insert(schema.sessions).values({
      token_hash: 'hash-expired',
      user_id: user.id,
      expires_at: new Date(now.getTime() + 24 * HOUR),
    });
    await handle.db
      .insert(schema.oauthAccounts)
      .values({ provider: 'github', provider_account_id: '999', user_id: user.id });

    const result = await sweepUnverifiedAccounts(handle.db, { now });

    expect(result).toEqual({ scanned: 1, reminded: 0, purged: 1 });
    const [after] = await handle.db.select().from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
    expect(after?.state).toBe('deleted');
    expect(after?.username.startsWith('deleted_')).toBe(true);
    expect(after?.email.endsWith('@deleted.invalid')).toBe(true);
    // 会话吊销 + GitHub 让位（同一个 GitHub 之后能绑到新账号）
    const sessions = await handle.db.select().from(schema.sessions).where(eq(schema.sessions.user_id, user.id));
    expect(sessions[0]?.revoked_at).not.toBeNull();
    const links = await handle.db.select().from(schema.oauthAccounts).where(eq(schema.oauthAccounts.user_id, user.id));
    expect(links).toHaveLength(0);
    // 到期的账号不发提醒信，直接注销
    expect(await queuedMails()).toHaveLength(0);
  });

  it('中途验证过的账号不再进名单', async () => {
    await seedUser('sweep-verified', {
      createdAt: new Date(now.getTime() - 5 * 24 * HOUR),
      state: 'active',
    });

    const result = await sweepUnverifiedAccounts(handle.db, { now });

    expect(result).toEqual({ scanned: 0, reminded: 0, purged: 0 });
  });

  it('OAuth 占位邮箱发不出信：不发提醒，但到期照样注销', async () => {
    const placeholder = await seedUser('sweep-placeholder', {
      createdAt: new Date(now.getTime() - 5 * HOUR),
      email: 'github-123@users.noreply',
    });
    expect((await sweepUnverifiedAccounts(handle.db, { now })).reminded).toBe(0);
    expect(await queuedMails()).toHaveLength(0);

    await handle.db
      .update(schema.users)
      .set({ created_at: new Date(now.getTime() - 4 * 24 * HOUR) })
      .where(eq(schema.users.id, placeholder.id));
    expect((await sweepUnverifiedAccounts(handle.db, { now })).purged).toBe(1);
  });

  it('剩余时间按天/小时向上取整', () => {
    const user = { created_at: now };
    expect(hoursUntilPurge(user, now, 3)).toBe(72);
    expect(hoursUntilPurge(user, new Date(now.getTime() + 71 * HOUR), 3)).toBe(1);
    expect(hoursUntilPurge(user, new Date(now.getTime() + 60 * HOUR), 3)).toBe(12);
  });
});

describe('新设备确认', () => {
  it('新设备开会话会发确认信，确认后（trusted_devices 有行）不再发', async () => {
    const user = await seedUser('device-start', { state: 'active' });
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/154.0.0.0 Safari/537.36';

    const first = await startSession(handle.db, user, { ip: '203.0.113.9', userAgent: ua });
    expect(first.deviceTrusted).toBe(false);
    expect(first.deviceMailSent).toBe(true);

    const mails = await queuedMails();
    expect(mails).toHaveLength(1);
    expect(mails[0]?.template).toBe('verify_device');
    expect(mails[0]?.html).toContain('新设备');
    expect(mails[0]?.text).toContain('203.0.113.9');

    // 本人确认这台设备之后，同一 UA（哪怕版本号变了）都不再算新设备。
    const fingerprint = deviceFingerprint(ua);
    expect(fingerprint).not.toBeNull();
    await trustDevice(handle.db, user.id, fingerprint as string, 'Chrome · Windows');

    const second = await startSession(handle.db, user, {
      ip: '203.0.113.9',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/155.0.0.0 Safari/537.36',
    });
    expect(second.deviceTrusted).toBe(true);
    expect(second.deviceMailSent).toBe(false);
    expect(await queuedMails()).toHaveLength(1);
  });

  it('未验证邮箱的账号不发新设备确认信（先验证邮箱，别一次收两封）', async () => {
    const user = await seedUser('device-unverified', { state: 'unverified' });

    const started = await startSession(handle.db, user, { userAgent: 'Mozilla/5.0 (X11; Linux) Firefox/128.0' });

    expect(started.deviceTrusted).toBe(false);
    expect(started.deviceMailSent).toBe(false);
    expect(await queuedMails()).toHaveLength(0);
  });

  it('占位邮箱的 OAuth 账号也发不出新设备确认信', async () => {
    const user = await seedUser('device-placeholder', { state: 'active', email: 'github-777@users.noreply' });

    const started = await startSession(handle.db, user, { userAgent: 'Dart/3.13 (dart:io)' });

    expect(started.deviceMailSent).toBe(false);
  });

  it('不带 User-Agent 的登录同样要确认（否则少发一个头就能绕过新设备闸门）', async () => {
    const user = await seedUser('device-no-ua', { state: 'active' });

    const started = await startSession(handle.db, user);

    expect(started.deviceTrusted).toBe(false);
    expect(started.deviceMailSent).toBe(true);
    const sessions = await handle.db.select().from(schema.sessions).where(eq(schema.sessions.user_id, user.id));
    expect(sessions[0]?.device_hash).toBe('no-user-agent');
  });

  it('设备确认令牌里带着设备指纹，一次有效', async () => {
    const user = await seedUser('device-token', { state: 'active' });
    const fingerprint = deviceFingerprint('Mozilla/5.0 (X11; Linux x86_64) Chrome/154.0.0.0') as string;
    await issueDeviceVerificationToken(handle.db, user, {
      deviceHash: fingerprint,
      deviceLabel: 'Chrome · Linux',
      ip: '198.51.100.7',
    });

    const jobs = await handle.db.select().from(schema.jobs).where(eq(schema.jobs.kind, 'send_email'));
    const html = (jobs[0]?.payload as { html?: string }).html ?? '';
    expect(html).toContain('/verify-device?token=');

    const tokens = await handle.db.select().from(schema.emailTokens);
    expect(tokens[0]?.purpose).toBe('verify_device');
    expect(tokens[0]?.device_hash).toBe(fingerprint);
  });
});
