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
import { getEnv } from '@ycomm/kernel';
import type { AccessSubject } from '@ycomm/access';
import type { AppVariables } from '../context';

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
      });
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