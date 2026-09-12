import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { getDb } from '@ycomm/db';
import { findSessionByToken, toPublicUser } from '@ycomm/identity';
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
      const user = found.user;
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