import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { getDb } from '@ycomm/db';
import {
  authenticateApiKey,
  expireSanctions,
  findSessionByToken,
  toPublicUser,
  touchApiKey,
  touchSessionIfStale,
} from '@ycomm/identity';
import { errors, getEnv } from '@ycomm/kernel';
import type { AccessSubject } from '@ycomm/access';
import type { AppVariables } from '../context';

/**
 * 未验证邮箱的账号还允许调用的接口。
 *
 * 「绑定邮箱的账号必须验证邮箱才能用」——但验证本身、以及验证之前必须能做的
 * 自助动作（重新登录、重发验证信、找回密码、看自己是谁、退出、注销账号）不能一起拦掉，
 * 否则用户连验证的入口都点不到。
 */
const UNVERIFIED_ALLOWED: ReadonlyArray<{ method: string; path: RegExp }> = [
  {
    method: 'POST',
    path: /^\/api\/auth\/(register|login|logout|verify-email|resend-verification|forgot-password|reset-password|delete-account|delete-account\/confirm|cancel-deletion)$/,
  },
  { method: 'GET', path: /^\/api\/auth\/(me|github|github\/callback)$/ },
];

/**
 * 待确认的新设备还允许调用的接口：确认/重发确认信、看自己是谁、退出。
 * 别的都不行 —— 这台设备还没证明是本人。
 */
const PENDING_DEVICE_ALLOWED: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: 'POST', path: /^\/api\/auth\/(verify-device|resend-device|logout)$/ },
  { method: 'GET', path: /^\/api\/auth\/me$/ },
];

function matches(rules: ReadonlyArray<{ method: string; path: RegExp }>, method: string, path: string): boolean {
  return rules.some((rule) => rule.method === method.toUpperCase() && rule.path.test(path));
}

/**
 * Resolves the session cookie into `c.var.auth` when present and valid.
 *
 * Guest requests are perfectly legal here — routes decide whether a session is
 * required. The `subject` is the full gate input (state, ban/mute data) used
 * only inside the backend; the client only ever sees `user`.
 */
export const sessionAuth = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const env = getEnv();
  const rawToken = getCookie(c, env.SESSION_COOKIE_NAME);
  if (rawToken) {
    const handle = await getDb();
    const found = await findSessionByToken(handle.db, rawToken);
    if (found) {
      // 限时封禁/禁言到期即在解析会话时自动解除（无需定时任务）。
      const user = await expireSanctions(handle.db, found.user);
      const subject: AccessSubject = {
        id: user.id,
        role: user.role,
        level: user.level,
        state: user.state,
        mutedUntil: user.muted_until,
        banReason: user.ban_reason,
      };
      c.set('auth', {
        user: toPublicUser(user),
        subject,
        userId: user.id,
        sessionId: found.session.id,
        deviceTrusted: found.deviceTrusted,
      });

      // 闸门 A：绑定邮箱注册的账号必须先验证邮箱，否则什么内容都看不到。
      if (subject.state === 'unverified' && !matches(UNVERIFIED_ALLOWED, c.req.method, c.req.path)) {
        throw errors.accountUnverified();
      }
      // 闸门 B：这台设备该账号没见过，先确认是本人在用（邮箱没验证时由闸门 A 负责，
      // 那时也不再发新设备确认信，免得一次登录收两封）。
      if (
        subject.state !== 'unverified' &&
        !found.deviceTrusted &&
        !matches(PENDING_DEVICE_ALLOWED, c.req.method, c.req.path)
      ) {
        throw errors.deviceUnverified();
      }

      // 「最近活跃」按 5 分钟节流写入（登录设备管理列表展示用）；API 密钥分支不走这里。
      await touchSessionIfStale(handle.db, found.session.id, found.session.last_used_at);
    }
  }

  // 没有会话 Cookie 时，尝试开放 API 密钥：Authorization: Bearer <key>（仅站长）。
  // 只读密钥只允许 GET/HEAD，写操作直接 403。
  if (!c.get('auth')) {
    const header = c.req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    const rawKey = match?.[1]?.trim();
    if (rawKey) {
      const handle = await getDb();
      const result = await authenticateApiKey(handle.db, rawKey);
      if (result) {
        const method = c.req.method.toUpperCase();
        if (result.readOnly && method !== 'GET' && method !== 'HEAD') {
          return c.json(
            {
              ok: false,
              error: {
                code: 'ACCESS_FORBIDDEN',
                messageKey: 'ACCESS_FORBIDDEN',
                message: '这是一枚只读 API 密钥，不能执行写操作',
                meta: {},
              },
            },
            403,
          );
        }
        const subject: AccessSubject = {
          id: result.user.id,
          role: result.user.role,
          level: result.user.level,
          state: result.user.state,
          mutedUntil: result.user.muted_until,
          banReason: result.user.ban_reason,
        };
        c.set('auth', {
          user: toPublicUser(result.user),
          subject,
          userId: result.user.id,
          sessionId: result.keyId,
          viaApiKey: true,
          readOnly: result.readOnly,
          // 密钥是账号持有人自己在后台签发的，天然算「已确认的设备」。
          deviceTrusted: true,
        });
        // 记录最近使用时间（一分钟节流）。
        await touchApiKey(handle.db, result.keyId, result.lastUsedAt);
      }
    }
  }

  await next();
});

/** Require a session; guest requests get 401 ACCESS_LOGIN_REQUIRED. */
export const requireAuth = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  if (!c.get('auth')) {
    return c.json(
      {
        ok: false,
        error: { code: 'ACCESS_LOGIN_REQUIRED', messageKey: 'ACCESS_LOGIN_REQUIRED', meta: {} },
      },
      401,
    );
  }
  await next();
});

/**
 * The real client IP of the request.
 *
 * Behind a Cloudflare tunnel the connection peer is always cloudflared's
 * loopback/private address, so the true visitor IP must come from the headers
 * Cloudflare adds. That header is trusted only when the operator says so
 * (`TRUST_PROXY_HEADERS`), which is the same switch that makes rate limiting
 * and bans meaningful behind a proxy.
 */
export function clientIp(c: { req: { header(name: string): string | undefined } }): string {
  const env = getEnv();
  if (env.TRUST_PROXY_HEADERS) {
    const forwarded = c.req.header('x-forwarded-for');
    return (
      c.req.header('cf-connecting-ip') ??
      (forwarded ? forwarded.split(',')[0]?.trim() : undefined) ??
      'unknown'
    );
  }
  return 'unknown';
}