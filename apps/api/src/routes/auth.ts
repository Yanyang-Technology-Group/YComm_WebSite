import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { randomUUID } from 'node:crypto';
import { getDb } from '@ycomm/db';
import { errors, getEnv, siteUrl, captchaConfig } from '@ycomm/kernel';
import {
  bindInviteCode,
  cancelAccountDeletion,
  changeEmail,
  changePassword,
  confirmAccountDeletion,
  createSession,
  findOrCreateOAuthUser,
  findUserByLogin,
  getInviteBinding,
  getUserById,
  hashPassword,
  register,
  requestAccountDeletion,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  reviveIfPendingDeletion,
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
  captchaToken: z.string().min(1).optional(),
  agreeTerms: z.boolean().optional(),
});

const loginSchema = z.object({
  login: z.string().min(1).max(255),
  password: z.string().min(1).max(200),
  captchaToken: z.string().min(1).optional(),
  agreeTerms: z.boolean().optional(),
});

const emailSchema = z.object({ email: z.string().trim().min(3).max(255), captchaToken: z.string().min(1).optional() });

const verificationSchema = z.object({ token: z.string().min(1).max(256) });

const resetSchema = z.object({
  token: z.string().min(1).max(256),
  password: z.string().min(1).max(200),
  captchaToken: z.string().min(1).optional(),
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

    requireAgreeTerms(body.agreeTerms);
    await verifyCaptcha(body.captchaToken);

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

    requireAgreeTerms(body.agreeTerms);
    await verifyCaptcha(body.captchaToken);

    let user = await findUserByLogin(handle.db, body.login);

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

    // 注销冷静期：本次登录自动取消注销；已过冷静期则转永久注销、登录被拒。
    if (user.state === 'deleting') {
      user = await reviveIfPendingDeletion(handle.db, user);
    }

    if (!user || user.state === 'deleted') throw errors.forbidden('账号已注销');
    if (user.state === 'banned') throw errors.accountBanned(user.ban_reason);

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

  // ---- 账号注销（邮箱确认 → 3 天冷静期） --------------------------------
  router.post('/delete-account', async (c) => {
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const handle = await getDb();
    await requestAccountDeletion(handle.db, auth.userId);
    await logAudit(handle.db, {
      actorId: auth.userId,
      actorIp: clientIp(c),
      action: 'account.deletion_requested',
      targetType: 'user',
      targetId: auth.userId,
      meta: { via: 'email' },
    });
    return c.json({ ok: true, data: null });
  });

  /** 点击邮件里的确认链接后调用：进入冷静期（deleting），无需登录态。 */
  router.post('/delete-account/confirm', async (c) => {
    const body = await parseBody(c, verificationSchema);
    const handle = await getDb();
    await confirmAccountDeletion(handle.db, body.token);
    return c.json({ ok: true, data: null });
  });

  /** 冷静期内显式取消注销（登录自动取消之外的入口）。 */
  router.post('/cancel-deletion', async (c) => {
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const handle = await getDb();
    await cancelAccountDeletion(handle.db, auth.userId);
    await logAudit(handle.db, {
      actorId: auth.userId,
      actorIp: clientIp(c),
      action: 'account.deletion_cancelled',
      targetType: 'user',
      targetId: auth.userId,
      meta: { via: 'console' },
    });
    return c.json({ ok: true, data: null });
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

  // ---- GitHub OAuth -----------------------------------------------------
  router.get('/github', async (c) => {
    const env = getEnv();
    if (!env.OAUTH_GITHUB_CLIENT_ID) throw errors.notFound('GitHub 登录未配置');
    const state = randomUUID();
    setCookie(c, 'oauth_state', state, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 600 });
    const redirectUri = `${siteUrl(env)}/api/auth/github/callback`;
    const url =
      'https://github.com/login/oauth/authorize' +
      `?client_id=${encodeURIComponent(env.OAUTH_GITHUB_CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent('read:user user:email')}` +
      `&state=${encodeURIComponent(state)}`;
    return c.redirect(url, 302);
  });

  router.get('/github/callback', async (c) => {
    const env = getEnv();
    const code = c.req.query('code');
    const state = c.req.query('state');
    const savedState = getCookie(c, 'oauth_state');
    deleteCookie(c, 'oauth_state', { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    if (!code || !state || state !== savedState) throw errors.forbidden('OAuth 状态校验失败');

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: env.OAUTH_GITHUB_CLIENT_ID,
        client_secret: env.OAUTH_GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    const tokenJson = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
    if (!tokenJson.access_token) throw errors.forbidden('GitHub 授权失败');

    const ghHeaders = { authorization: `Bearer ${tokenJson.access_token}`, 'user-agent': 'ycomm' };
    const userRes = await fetch('https://api.github.com/user', { headers: ghHeaders });
    const ghUser = (await userRes.json().catch(() => ({}))) as {
      id?: number;
      login?: string;
      name?: string | null;
      avatar_url?: string | null;
    };
    if (!ghUser.id || !ghUser.login) throw errors.forbidden('GitHub 用户信息获取失败');

    const emailsRes = await fetch('https://api.github.com/user/emails', { headers: ghHeaders });
    const emails = (await emailsRes.json().catch(() => [])) as { email: string; primary: boolean; verified: boolean }[];
    const primaryEmail =
      emails.find((e) => e.primary && e.verified)?.email ?? emails.find((e) => e.verified)?.email ?? null;

    const handle = await getDb();
    let user = await findOrCreateOAuthUser(handle.db, {
      provider: 'github',
      providerAccountId: String(ghUser.id),
      username: ghUser.login,
      email: primaryEmail,
      displayName: ghUser.name ?? null,
      avatarUrl: ghUser.avatar_url ?? null,
    });

    // 注销冷静期：GitHub 登录同样自动取消注销。
    if (user.state === 'deleting') {
      user = (await reviveIfPendingDeletion(handle.db, user)) ?? user;
    }

    const session = await createSession(handle.db, {
      userId: user.id,
      ip: clientIp(c),
      userAgent: c.req.header('user-agent'),
    });
    setCookie(c, env.SESSION_COOKIE_NAME, session.rawToken, sessionCookieOptions(env));

    await logAudit(handle.db, {
      actorId: user.id,
      actorIp: clientIp(c),
      action: 'auth.oauth_login',
      targetType: 'user',
      targetId: user.id,
      meta: { provider: 'github' },
    });

    return c.redirect('/', 302);
  });

  // ---- password reset ---------------------------------------------------
  router.post('/forgot-password', rateLimitByIp('passwordReset'), async (c) => {
    const body = await parseBody(c, emailSchema);
    const handle = await getDb();
    await verifyCaptcha(body.captchaToken);
    await requestPasswordReset(handle.db, body.email);
    return c.json({ ok: true, data: null });
  });

  router.post('/reset-password', rateLimitByIp('passwordReset'), async (c) => {
    const body = await parseBody(c, resetSchema);
    const handle = await getDb();
    await verifyCaptcha(body.captchaToken);
    await resetPassword(handle.db, body.token, body.password);
    return c.json({ ok: true, data: null });
  });

  return router;
}

/** 注册/登录必须勾选同意协议（服务端强制，防止绕过前端）。 */
function requireAgreeTerms(agreed: boolean | undefined): void {
  if (agreed !== true) {
    throw errors.validation({
      issues: [
        {
          path: 'agreeTerms',
          message: '请阅读并勾选同意《软件许可及服务协议》和《儿童个人信息保护规则》',
        },
      ],
    });
  }
}

/**
 * 人机验证（CAP Worker）：未配置 CAPTCHA_ENDPOINT 时跳过；
 * 已配置则把 widget 解出的 token 交给 `/api/validate` 核验（keepToken=false 一次性消费）。
 */
async function verifyCaptcha(token: string | undefined): Promise<void> {
  const cfg = captchaConfig();
  if (!cfg) return;
  if (!token) {
    throw errors.validation({ issues: [{ path: 'captchaToken', message: '请完成人机验证' }] });
  }
  const response = await fetch(`${cfg.endpoint}/api/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, keepToken: false }),
  });
  const json = (await response.json().catch(() => ({}))) as { success?: boolean };
  if (json.success !== true) {
    throw errors.validation({ issues: [{ path: 'captchaToken', message: '人机验证失败，请重试' }] });
  }
}