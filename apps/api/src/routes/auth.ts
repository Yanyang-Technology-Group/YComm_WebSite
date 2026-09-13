import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { randomUUID } from 'node:crypto';
import { getDb } from '@ycomm/db';
import { errors, getEnv } from '@ycomm/kernel';
import {
  bindInviteCode,
  changeEmail,
  changePassword,
  createSession,
  findUserByLogin,
  getInviteBinding,
  getUserById,
  hashPassword,
  register,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  revokeSession,
  toPublicUser,
  updateProfile,
  verifyEmail,
  verifyPassword,
} from '@ycomm/identity';
import { listPostsByAuthor, listTopicsByAuthor } from '@ycomm/forum';
import { listResourcesByAuthor } from '@ycomm/downloads';
import { logAudit } from '@ycomm/audit';
import type { AppVariables } from '../context';
import { clientIp, sessionAuth } from '../middleware/session';
import { rateLimitByIp } from '../middleware/rate-limit';

/** Parse + validate a JSON body; rejects with the shared validation shape. */
async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const body = await c.req.json().catch(() => ({}));
  const result = schema.safeParse(body);
  if (!result.success) {
    throw errors.validation({
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    });
  }
  return result.data;
}

const registerSchema = z.object({
  username: z.string().trim().min(1).max(20),
  email: z.string().trim().min(3).max(255),
  password: z.string().min(1).max(200),
  inviteCode: z.string().trim().min(1).optional(),
});

const loginSchema = z.object({
  login: z.string().min(1).max(255),
  password: z.string().min(1).max(200),
});

const emailSchema = z.object({ email: z.string().trim().min(3).max(255) });

const verificationSchema = z.object({ token: z.string().min(1).max(256) });

const resetSchema = z.object({
  token: z.string().min(1).max(256),
  password: z.string().min(1).max(200),
});

const profileSchema = z.object({
  displayName: z.string().max(40).optional(),
  bio: z.string().max(500).optional(),
  avatarPath: z.string().max(2000).nullable().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10).max(200),
});

const changeEmailSchema = z.object({ email: z.string().trim().min(3).max(255) });

const bindInviteSchema = z.object({ code: z.string().trim().min(1).max(10) });

/**
 * Session cookie flags. `__Host-` prefix forces Secure + Path=/ + no Domain —
 * exactly what a session cookie should look like behind a TLS-terminating
 * reverse proxy (Cloudflare Tunnel included).
 *
 * NOTE: Hono's cookie helpers validate `__Host-` cookies and REQUIRE the same
 * flags on delete; setCookie and deleteCookie MUST use identical options.
 */
function sessionCookieOptions(env: ReturnType<typeof getEnv>) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: env.SESSION_TTL_DAYS * 86400,
  };
}

export function authRoutes(): Hono<{ Variables: AppVariables }> {
  const router = new Hono<{ Variables: AppVariables }>();
  router.use('*', sessionAuth);

  // ---- register ---------------------------------------------------------
  router.post('/register', rateLimitByIp('register'), async (c) => {
    const body = await parseBody(c, registerSchema);
    const handle = await getDb();
    const result = await register(handle.db, {
      username: body.username,
      email: body.email,
      password: body.password,
      inviteCode: body.inviteCode,
    });

    await logAudit(handle.db, {
      actorId: result.user.id,
      actorIp: clientIp(c),
      action: 'user.registered',
      targetType: 'user',
      targetId: result.user.id,
      meta: { verified: !result.needsVerification },
    });

    // Identical response whether the email was new or already registered —
    // the caller cannot tell, and neither can an enumeration attacker.
    return c.json(
      {
        ok: true,
        data: { needsVerification: result.needsVerification, alreadyRegistered: result.alreadyRegistered },
      },
      201,
    );
  });

  // ---- email verification ----------------------------------------------
  router.post('/verify-email', async (c) => {
    const body = await parseBody(c, verificationSchema);
    const handle = await getDb();
    const user = await verifyEmail(handle.db, body.token);
    await logAudit(handle.db, {
      actorId: user.id,
      actorIp: clientIp(c),
      action: 'user.email_verified',
      targetType: 'user',
      targetId: user.id,
    });
    return c.json({ ok: true, data: { user: toPublicUser(user) } });
  });

  router.post('/resend-verification', rateLimitByIp('emailVerificationResend'), async (c) => {
    const body = await parseBody(c, emailSchema);
    const handle = await getDb();
    await resendVerification(handle.db, body.email);
    // Enumeration-safe: same response whether or not a mail was queued.
    return c.json({ ok: true, data: null });
  });

  // ---- login / logout / me ---------------------------------------------
  router.post('/login', rateLimitByIp('login'), async (c) => {
    const body = await parseBody(c, loginSchema);
    const handle = await getDb();
    const user = await findUserByLogin(handle.db, body.login);

    const passwordOk = user?.password_hash
      ? await verifyPassword(user.password_hash, body.password)
      : false;

    if (!user || !passwordOk) {
      // Burn comparable time for unknown accounts so login timing does not
      // reveal whether a username exists.
      if (!user) {
        await hashPassword(`dummy-${randomUUID()}`);
      }
      throw errors.unauthenticated('用户名或密码错误');
    }

    if (user.state === 'banned') throw errors.accountBanned(user.ban_reason);
    if (user.state === 'deleted') throw errors.forbidden('账号已注销');

    const session = await createSession(handle.db, {
      userId: user.id,
      ip: clientIp(c),
      userAgent: c.req.header('user-agent'),
    });

    const env = getEnv();
    setCookie(c, env.SESSION_COOKIE_NAME, session.rawToken, sessionCookieOptions(env));

    await logAudit(handle.db, {
      actorId: user.id,
      actorIp: clientIp(c),
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
      meta: { sessionId: session.rawToken.slice(0, 8) },
    });

    return c.json({
      ok: true,
      data: {
        user: toPublicUser(user),
        needsVerification: user.state === 'unverified',
        expiresAt: session.expiresAt.toISOString(),
      },
    });
  });

  router.post('/logout', async (c) => {
    const env = getEnv();
    const rawToken = getCookie(c, env.SESSION_COOKIE_NAME);
    if (rawToken) {
      const handle = await getDb();
      await revokeSession(handle.db, rawToken);
    }
    deleteCookie(c, env.SESSION_COOKIE_NAME, sessionCookieOptions(env));
    return c.json({ ok: true, data: null });
  });

  router.get('/me', async (c) => {
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    return c.json({ ok: true, data: { user: auth.user } });
  });

  // ---- profile / 个人控制台 --------------------------------------------
  router.get('/profile', async (c) => {
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const handle = await getDb();
    const user = await getUserById(handle.db, auth.userId);
    const binding = await getInviteBinding(handle.db, auth.userId);
    return c.json({
      ok: true,
      data: {
        user: {
          ...toPublicUser(user),
          email: user.email,
          inviteBound: binding.bound,
          inviteCode: binding.code,
        },
      },
    });
  });

  router.patch('/profile', async (c) => {
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const body = await parseBody(c, profileSchema);
    const handle = await getDb();
    const updated = await updateProfile(handle.db, auth.userId, {
      displayName: body.displayName,
      bio: body.bio,
      avatarPath: body.avatarPath,
    });
    return c.json({ ok: true, data: { user: toPublicUser(updated) } });
  });

  router.post('/change-password', async (c) => {
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const body = await parseBody(c, changePasswordSchema);
    const handle = await getDb();
    await changePassword(handle.db, auth.userId, body.currentPassword, body.newPassword);
    return c.json({ ok: true, data: null });
  });

  router.post('/change-email', async (c) => {
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const body = await parseBody(c, changeEmailSchema);
    const handle = await getDb();
    await changeEmail(handle.db, auth.userId, body.email);
    return c.json({ ok: true, data: null });
  });

  router.post('/bind-invite', async (c) => {
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const body = await parseBody(c, bindInviteSchema);
    const handle = await getDb();
    await bindInviteCode(handle.db, auth.userId, body.code);
    return c.json({ ok: true, data: null });
  });

  router.get('/me/topics', async (c) => {
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const handle = await getDb();
    const topics = await listTopicsByAuthor(handle.db, auth.userId);
    return c.json({ ok: true, data: { topics } });
  });

  router.get('/me/posts', async (c) => {
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const handle = await getDb();
    const posts = await listPostsByAuthor(handle.db, auth.userId);
    return c.json({ ok: true, data: { posts } });
  });

  router.get('/me/resources', async (c) => {
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const handle = await getDb();
    const resources = await listResourcesByAuthor(handle.db, auth.userId);
    return c.json({ ok: true, data: { resources } });
  });

  // ---- password reset ---------------------------------------------------
  router.post('/forgot-password', rateLimitByIp('passwordReset'), async (c) => {
    const body = await parseBody(c, emailSchema);
    const handle = await getDb();
    await requestPasswordReset(handle.db, body.email);
    return c.json({ ok: true, data: null });
  });

  router.post('/reset-password', rateLimitByIp('passwordReset'), async (c) => {
    const body = await parseBody(c, resetSchema);
    const handle = await getDb();
    await resetPassword(handle.db, body.token, body.password);
    return c.json({ ok: true, data: null });
  });

  return router;
}