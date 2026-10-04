import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { randomUUID } from 'node:crypto';
import { getDb, type Db } from '@ycomm/db';
import { AUTH } from '@ycomm/config';
import { errors, ErrorCodes, getEnv, isAppError, siteUrl, logger } from '@ycomm/kernel';
import {
  bindInviteCode,
  cancelAccountDeletion,
  changeEmail,
  changePassword,
  confirmAccountDeletion,
  describeDevice,
  deviceFingerprint,
  expireSanctions,
  findOrCreateOAuthUser,
  findUserByLogin,
  getInviteBinding,
  getUserById,
  hashPassword,
  isDeliverableEmail,
  issueDeviceVerificationToken,
  issueVerificationTokenForUser,
  linkOAuthAccount,
  listActiveSessionsForUser,
  listOAuthProviders,
  listTrustedDevices,
  register,
  requestAccountDeletion,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  reviveIfPendingDeletion,
  revokeOtherSessionForUser,
  revokeOtherSessionsForUser,
  revokeSession,
  revokeTrustedDevice,
  setPassword,
  setThemePreference,
  startSession,
  toPublicUser,
  trustDevice,
  unlinkOAuthAccount,
  updateProfile,
  verifyDeviceToken,
  verifyEmail,
  verifyPassword,
  type NewSession,
  type UserRecord,
} from '@ycomm/identity';
import { listPostsByAuthor, listTopicsByAuthor } from '@ycomm/forum';
import { listResourcesByAuthor } from '@ycomm/downloads';
import { logAudit } from '@ycomm/audit';
import type { AppVariables } from '../context';
import { clientIp, sessionAuth } from '../middleware/session';
import { captchaTokenFields, captchaTokenOf, verifyCaptcha, verifyCaptchaOrRefund } from '../middleware/captcha';
import { rateLimitByIp, refundRateLimitByIp } from '../middleware/rate-limit';
import type { RateLimitName } from '@ycomm/config';

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

/**
 * 人机验证 + 探测退额度：客户端（App）提交前会先不带 token 发一次，拿到
 * `captchaToken` 字段错误再弹码重发；那次「探测」不应消耗本规则的限流额度。
 */
async function checkCaptcha(c: Context, rule: RateLimitName, body: unknown): Promise<void> {
  await verifyCaptchaOrRefund(captchaTokenOf(body), () => refundRateLimitByIp(rule, clientIp(c)));
}

/**
 * 登录成功后统一开会话（含新设备确认信）。
 *
 * 实现在 `@ycomm/identity` 的 `startSession` 里：密码登录与 GitHub 回调必须走
 * 完全一样的规则，否则换一种登录方式就能绕开「新设备要邮箱确认」。
 */
async function openSession(
  db: Db,
  user: UserRecord,
  options: { ip?: string; userAgent?: string; ttlDays?: number },
): Promise<NewSession> {
  const session = await startSession(db, user, options);
  return { rawToken: session.rawToken, expiresAt: session.expiresAt };
}

const registerSchema = z.object({
  username: z.string().trim().min(1).max(20),
  email: z.string().trim().min(3).max(255),
  password: z.string().min(1).max(200),
  inviteCode: z.string().trim().min(1).optional(),
  ...captchaTokenFields,
  agreeTerms: z.boolean().optional(),
});

const loginSchema = z.object({
  login: z.string().min(1).max(255),
  password: z.string().min(1).max(200),
  ...captchaTokenFields,
  agreeTerms: z.boolean().optional(),
  /** 勾选 = 15 天内免登录（持久 cookie）；不勾 = 关浏览器即退出。 */
  rememberMe: z.boolean().optional(),
});

const emailSchema = z.object({ email: z.string().trim().min(3).max(255), ...captchaTokenFields });

const verificationSchema = z.object({ token: z.string().min(1).max(256) });

const resetSchema = z.object({
  token: z.string().min(1).max(256),
  password: z.string().min(1).max(200),
  ...captchaTokenFields,
});

const profileSchema = z.object({
  displayName: z.string().max(40).optional(),
  bio: z.string().max(500).optional(),
  avatarPath: z.string().max(2000).nullable().optional(),
  homepageMd: z.string().max(8000).optional(),
  followingVisibility: z.enum(['public', 'mutual', 'private']).optional(),
  followersVisibility: z.enum(['public', 'mutual', 'private']).optional(),
  homepageVisibility: z.enum(['public', 'mutual', 'private']).optional(),
  /** 是否允许被别人搜到（控制台 → 隐私设置）。 */
  searchable: z.boolean().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

const changeEmailSchema = z.object({ email: z.string().trim().min(3).max(255) });

const bindInviteSchema = z.object({ code: z.string().trim().min(1).max(10) });
const oauthUnlinkSchema = z.object({ provider: z.enum(['github', 'google']) });
const themeSchema = z.object({
  colour: z.enum(['azure', 'red', 'pink', 'mint', 'orange', 'slate', 'none']),
  mode: z.enum(['auto', 'dark', 'light']),
});

const setPasswordSchema = z.object({ newPassword: z.string().min(8).max(200) });

const deleteAccountSchema = z.object({ ...captchaTokenFields });

/**
 * Session cookie flags. `__Host-` 前缀强制 Secure + Path=/ + 无 Domain。
 * 「记住我」= maxAge 15 天；不记住 = 浏览器会话 cookie（关浏览器即退出）。
 */
function sessionCookieOptions(_env: ReturnType<typeof getEnv>, rememberMe = false) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
    path: '/',
    ...(rememberMe ? { maxAge: 15 * 86400 } : {}),
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
    await checkCaptcha(c, 'register', body);

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

    // 在同一浏览器点开的验证链接：顺手给这台还没确认的设备发一封新设备确认信，
    // 否则用户刚验证完邮箱、又被「新设备」拦一次，还得手动点重发。
    const auth = c.get('auth');
    if (auth && auth.userId === user.id && !auth.deviceTrusted) {
      const userAgent = c.req.header('user-agent');
      const deviceHash = deviceFingerprint(userAgent);
      if (deviceHash && isDeliverableEmail(user.email)) {
        await issueDeviceVerificationToken(handle.db, user, {
          deviceHash,
          deviceLabel: describeDevice(userAgent),
          ip: clientIp(c),
        });
      }
    }

    return c.json({ ok: true, data: { user: toPublicUser(user) } });
  });

  /**
   * 重发验证邮件。
   *
   * 两种用法：
   * - 已登录（验证引导页上的按钮）：用会话里的账号，不需要人机验证，也不会泄漏
   *   任何账号是否存在；
   * - 未登录（登录页的「没收到验证邮件？」）：必须带邮箱 + 人机验证，且无论账号
   *   存不存在都返回同一结果（防枚举）。
   */
  router.post('/resend-verification', rateLimitByIp('emailVerificationResend'), async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    if (auth) {
      const user = await getUserById(handle.db, auth.userId);
      if (user.state === 'unverified') {
        await issueVerificationTokenForUser(handle.db, user);
      }
      return c.json({ ok: true, data: { sent: true } });
    }

    const body = await parseBody(c, emailSchema);
    await verifyCaptcha(captchaTokenOf(body));
    await resendVerification(handle.db, body.email);
    // Enumeration-safe: same response whether or not a mail was queued.
    return c.json({ ok: true, data: null });
  });

  // ---- login / logout / me ---------------------------------------------
  router.post('/login', rateLimitByIp('login'), async (c) => {
    const body = await parseBody(c, loginSchema);
    const handle = await getDb();

    requireAgreeTerms(body.agreeTerms);
    await checkCaptcha(c, 'login', body);

    let user = await findUserByLogin(handle.db, body.login);

    // 没设置过密码的账号（GitHub 登录创建）不允许账号密码登录，给出明确的下一步。
    if (user && !user.password_hash) {
      throw errors.unauthenticated('该账号没有密码：请用 GitHub 登录，登录后在「账号安全」里创建密码');
    }

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
    // 限时封禁到期后自动解除，避免到期仍无法登录。
    user = await expireSanctions(handle.db, user);
    if (user.state === 'banned') throw errors.accountBanned(user.ban_reason);

    const rememberMe = body.rememberMe === true;
    const session = await openSession(handle.db, user, {
      ip: clientIp(c),
      userAgent: c.req.header('user-agent'),
      ttlDays: rememberMe ? 15 : undefined,
    });

    const env = getEnv();
    setCookie(c, env.SESSION_COOKIE_NAME, session.rawToken, sessionCookieOptions(env, rememberMe));

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
    // 主题偏好跟着会话一起下发：前端据此把主题切成该账号自己的配色（按账号生效）。
    const handle = await getDb();
    const user = await getUserById(handle.db, auth.userId);
    // 未验证邮箱还剩多久被自动注销：前端要显示倒计时，并告诉用户「不验证会没账号」。
    const graceEndsAt =
      user.state === 'unverified'
        ? new Date(user.created_at.getTime() + AUTH.verificationGraceDays * 86400_000).toISOString()
        : null;
    return c.json({
      ok: true,
      data: {
        user: {
          ...auth.user,
          themeColour: user.theme_colour,
          themeMode: user.theme_mode,
        },
        // 邮箱只回给本人（这里就是本人），前端验证引导页要显示「发到了哪个地址」。
        email: user.email,
        /** 账号邮箱还没验证：什么都看不了，先去验证。 */
        needsEmailVerification: user.state === 'unverified',
        /** 这台设备还没确认：先点邮箱里的确认链接。 */
        pendingDevice: !auth.deviceTrusted,
        verificationGraceEndsAt: graceEndsAt,
        verificationReminderHours: AUTH.verificationReminderHours,
      },
    });
  });

  // ---- 新设备确认（未确认前除验证相关接口外一律 403） -------------------

  /**
   * 确认这台设备：本人点邮件里的链接回到这里。
   *
   * 链接可能是在别的浏览器/客户端里点开的（邮件 App 用系统浏览器打开），所以只认
   * 令牌里的「用户 + 设备指纹」，不要求请求本身带着那个待确认的会话。
   */
  router.post('/verify-device', rateLimitByIp('emailVerificationResend'), async (c) => {
    const body = await parseBody(c, verificationSchema);
    const handle = await getDb();
    const claim = await verifyDeviceToken(handle.db, body.token);
    if (!claim) {
      throw errors.validation({ issues: [{ path: 'token', message: '确认链接无效或已过期' }] });
    }
    // 同一浏览器点开的：用当前 UA 描述出的设备名当标签；换浏览器点开就留空，
    // 该设备下次登录时会用当时的 UA 补上。
    const auth = c.get('auth');
    const label = auth?.userId === claim.userId ? describeDevice(c.req.header('user-agent')) : '';
    await trustDevice(handle.db, claim.userId, claim.deviceHash, label);
    await logAudit(handle.db, {
      actorId: claim.userId,
      actorIp: clientIp(c),
      action: 'auth.device_confirmed',
      targetType: 'user',
      targetId: claim.userId,
      meta: { label },
    });
    return c.json({ ok: true, data: { confirmed: true } });
  });

  /** 重发新设备确认邮件（当前会话所在的那台设备）。 */
  router.post('/resend-device', rateLimitByIp('emailVerificationResend'), async (c) => {
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    if (auth.deviceTrusted) return c.json({ ok: true, data: { sent: false } });

    const userAgent = c.req.header('user-agent');
    const deviceHash = deviceFingerprint(userAgent);
    const handle = await getDb();
    const user = await getUserById(handle.db, auth.userId);
    if (!deviceHash || !isDeliverableEmail(user.email)) {
      throw errors.validation({ issues: [{ path: 'email', message: '这个账号没有可用的邮箱，无法确认设备' }] });
    }
    await issueDeviceVerificationToken(handle.db, user, {
      deviceHash,
      deviceLabel: describeDevice(userAgent),
      ip: clientIp(c),
    });
    return c.json({ ok: true, data: { sent: true } });
  });

  /** 已确认（受信任）的设备列表。 */
  router.get('/trusted-devices', async (c) => {
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const handle = await getDb();
    const devices = await listTrustedDevices(handle.db, auth.userId);
    const currentHash = deviceFingerprint(c.req.header('user-agent'));
    return c.json({
      ok: true,
      data: { devices, currentDeviceHash: currentHash, currentDeviceTrusted: auth.deviceTrusted },
    });
  });

  /**
   * 撤销一台受信任设备：它上面的会话会一起吊销（相当于把人踢下线）。
   * 撤销当前这台设备 = 自己也会退出登录，前端要提示清楚。
   */
  router.delete('/trusted-devices/:deviceId', async (c) => {
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const handle = await getDb();
    const removed = await revokeTrustedDevice(handle.db, auth.userId, c.req.param('deviceId'));
    if (!removed) throw errors.notFound('设备不存在');
    await logAudit(handle.db, {
      actorId: auth.userId,
      actorIp: clientIp(c),
      action: 'auth.device_revoked',
      targetType: 'user',
      targetId: auth.userId,
      meta: { deviceId: c.req.param('deviceId') },
    });
    return c.json({ ok: true, data: null });
  });

  // ---- 账号注销（邮箱确认 → 3 天冷静期） --------------------------------
  router.post('/delete-account', async (c) => {
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const body = await parseBody(c, deleteAccountSchema);
    // 注销也要人机验证，防止外挂批量注销。
    await verifyCaptcha(captchaTokenOf(body));
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
    const oauthProviders = await listOAuthProviders(handle.db, auth.userId);
    return c.json({
      ok: true,
      data: {
        user: {
          ...toPublicUser(user),
          email: user.email,
          inviteBound: binding.bound,
          inviteCode: binding.code,
          // 绑定过的第三方登录来源（用于控制台展示「已绑定 GitHub」）。
          oauthProviders,
          // 主页内容与可见度（控制台「资料/隐私」里编辑）。
          homepageMd: user.homepage_md,
          followingVisibility: user.following_visibility,
          followersVisibility: user.followers_visibility,
          homepageVisibility: user.homepage_visibility,
          // 处罚状态：控制台据此提示「封禁/禁言期间不能注销」。
          mutedUntil: user.muted_until,
          muteReason: user.mute_reason,
          bannedUntil: user.banned_until,
          banReason: user.ban_reason,
          // 主题偏好（按账号存）：NULL = 从未设置，前端用「晏阳蓝 + 跟随系统」。
          themeColour: user.theme_colour,
          themeMode: user.theme_mode,
          // 隐私：是否允许被别人搜到（默认 true）。
          searchable: user.searchable,
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
      homepageMd: body.homepageMd,
      followingVisibility: body.followingVisibility,
      followersVisibility: body.followersVisibility,
      homepageVisibility: body.homepageVisibility,
      searchable: body.searchable,
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

  /** 给没有密码的账号（GitHub 登录创建）创建密码；创建后可用账号密码登录。 */
  router.post('/set-password', async (c) => {
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const body = await parseBody(c, setPasswordSchema);
    const handle = await getDb();
    await setPassword(handle.db, auth.userId, body.newPassword);
    await logAudit(handle.db, {
      actorId: auth.userId,
      actorIp: clientIp(c),
      action: 'auth.password_set',
      targetType: 'user',
      targetId: auth.userId,
    });
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

  /** 保存主题偏好（按账号存）：颜色 + 明暗。 */
  router.post('/theme', async (c) => {
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const body = await parseBody(c, themeSchema);
    const handle = await getDb();
    await setThemePreference(handle.db, auth.userId, body.colour, body.mode);
    return c.json({ ok: true, data: { themeColour: body.colour, themeMode: body.mode } });
  });

  /** 解绑第三方登录（GitHub）：没设置密码的账号不允许解绑（否则无法再登录）。 */
  router.post('/oauth/unlink', async (c) => {
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const body = await parseBody(c, oauthUnlinkSchema);
    const handle = await getDb();
    await unlinkOAuthAccount(handle.db, auth.userId, body.provider);
    await logAudit(handle.db, {
      actorId: auth.userId,
      actorIp: clientIp(c),
      action: 'auth.oauth_unlink',
      targetType: 'user',
      targetId: auth.userId,
      meta: { provider: body.provider },
    });
    const oauthProviders = await listOAuthProviders(handle.db, auth.userId);
    return c.json({ ok: true, data: { oauthProviders } });
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

  // ---- 登录设备管理（个人会话列表与远程退出） ----------------------------
  // 只接受普通 Session Cookie：未登录 401，Bearer API 密钥 403。
  // 一次登录 = 一条会话；当前会话只能走 /logout，不通过远程撤销接口退出。

  router.get('/sessions', async (c) => {
    const auth = requireCookieSession(c);
    const handle = await getDb();
    const sessions = await listActiveSessionsForUser(handle.db, auth.userId, auth.sessionId);
    return c.json({ ok: true, data: { sessions } });
  });

  router.post('/sessions/revoke-others', async (c) => {
    const auth = requireCookieSession(c);
    const handle = await getDb();
    const revokedCount = await revokeOtherSessionsForUser(handle.db, auth.userId, auth.sessionId);
    await logAudit(handle.db, {
      actorId: auth.userId,
      actorIp: clientIp(c),
      action: 'auth.other_sessions_revoked',
      targetType: 'user',
      targetId: auth.userId,
      meta: { revokedCount },
    });
    return c.json({ ok: true, data: { revokedCount } });
  });

  router.delete('/sessions/:sessionId', async (c) => {
    const auth = requireCookieSession(c);
    const targetId = parseSessionId(c.req.param('sessionId'));
    if (targetId === auth.sessionId) {
      throw errors.conflict('当前设备请使用退出登录');
    }
    const handle = await getDb();
    // 目标不存在、已失效或不属于当前用户，一律 404，不区分泄露归属。
    const revoked = await revokeOtherSessionForUser(handle.db, auth.userId, auth.sessionId, targetId);
    if (!revoked) throw errors.notFound('登录会话不存在');
    await logAudit(handle.db, {
      actorId: auth.userId,
      actorIp: clientIp(c),
      action: 'auth.session_revoked',
      targetType: 'session',
      targetId,
    });
    return c.json({ ok: true, data: null });
  });

  // ---- GitHub OAuth -----------------------------------------------------
  router.get('/github', async (c) => {
    const env = getEnv();
    if (!env.OAUTH_GITHUB_CLIENT_ID) throw errors.notFound('GitHub 登录未配置');
    const state = randomUUID();
    // 30 分钟有效期：GitHub 页面在国内可能很慢，10 分钟容易过期导致 state 校验失败。
    setCookie(c, 'oauth_state', state, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 1800 });
    // 控制台「绑定 GitHub」：?bind=1 时回调走绑定流程而不是登录流程。
    if (c.req.query('bind') === '1') {
      setCookie(c, 'oauth_intent', 'bind', { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 1800 });
    }
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
    const savedState = getCookie(c, 'oauth_state');
    const connectIntent = getCookie(c, 'oauth_intent');
    deleteCookie(c, 'oauth_state', { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    deleteCookie(c, 'oauth_intent', { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });

    const code = c.req.query('code');
    const state = c.req.query('state');
    const denied = c.req.query('error');

    // 统一失败出口：重定向回登录页并带原因（不再给用户看原始 JSON 错误）
    if (denied) {
      logger.warn('github oauth denied', { error: denied });
      return c.redirect('/login?oauth=denied', 302);
    }
    if (!code || !state || state !== savedState) {
      logger.warn('github oauth state mismatch', {
        hasCode: Boolean(code),
        hasState: Boolean(state),
        hasSavedState: Boolean(savedState),
      });
      return c.redirect('/login?oauth=state', 302);
    }

    try {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          client_id: env.OAUTH_GITHUB_CLIENT_ID,
          client_secret: env.OAUTH_GITHUB_CLIENT_SECRET,
          code,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
        access_token?: string;
        error?: string;
        error_description?: string;
      };
      if (!tokenJson.access_token) {
        logger.warn('github token exchange failed', {
          error: tokenJson.error,
          description: tokenJson.error_description,
        });
        return c.redirect('/login?oauth=token', 302);
      }

      const ghHeaders = { authorization: `Bearer ${tokenJson.access_token}`, 'user-agent': 'ycomm' };
      const userRes = await fetch('https://api.github.com/user', {
        headers: ghHeaders,
        signal: AbortSignal.timeout(20_000),
      });
      const ghUser = (await userRes.json().catch(() => ({}))) as {
        id?: number;
        login?: string;
        name?: string | null;
        avatar_url?: string | null;
      };
      if (!ghUser.id || !ghUser.login) {
        logger.warn('github profile fetch failed', { status: userRes.status });
        return c.redirect('/login?oauth=profile', 302);
      }

      const emailsRes = await fetch('https://api.github.com/user/emails', {
        headers: ghHeaders,
        signal: AbortSignal.timeout(20_000),
      });
      const emails = (await emailsRes.json().catch(() => [])) as {
        email: string;
        primary: boolean;
        verified: boolean;
      }[];
      const primaryEmail =
        emails.find((e) => e.primary && e.verified)?.email ?? emails.find((e) => e.verified)?.email ?? null;

      const handle = await getDb();

      // 控制台「绑定 GitHub」：把 OAuth 账号绑定到当前登录用户，而不是登录。
      if (connectIntent === 'bind') {
        const auth = c.get('auth');
        if (!auth) return c.redirect('/login?oauth=need_login', 302);
        try {
          await linkOAuthAccount(handle.db, auth.userId, 'github', String(ghUser.id));
        } catch (error) {
          // 「已被别人/冷静期账号占用」要和真正的故障分开，否则用户只看到一句「失败」。
          const taken = isAppError(error) && error.code === ErrorCodes.CONFLICT;
          return c.redirect(`/dashboard?bind=${taken ? 'taken' : 'error'}`, 302);
        }
        await logAudit(handle.db, {
          actorId: auth.userId,
          actorIp: clientIp(c),
          action: 'auth.oauth_bind',
          targetType: 'user',
          targetId: auth.userId,
          meta: { provider: 'github' },
        });
        return c.redirect('/dashboard?bind=done', 302);
      }

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
      if (user.state === 'deleted') return c.redirect('/login?oauth=deleted', 302);
      // 限时封禁到期后自动解除。
      user = await expireSanctions(handle.db, user);
      if (user.state === 'banned') return c.redirect('/login?oauth=banned', 302);

      const session = await openSession(handle.db, user, {
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
    } catch (error) {
      // 服务器到 GitHub 的网络在国内机房经常超时——给用户可读的提示
      logger.error('github oauth failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return c.redirect('/login?oauth=network', 302);
    }
  });

  // ---- password reset ---------------------------------------------------
  router.post('/forgot-password', rateLimitByIp('passwordReset'), async (c) => {
    const body = await parseBody(c, emailSchema);
    const handle = await getDb();
    await checkCaptcha(c, 'passwordReset', body);
    await requestPasswordReset(handle.db, body.email);
    return c.json({ ok: true, data: null });
  });

  router.post('/reset-password', rateLimitByIp('passwordReset'), async (c) => {
    const body = await parseBody(c, resetSchema);
    const handle = await getDb();
    await checkCaptcha(c, 'passwordReset', body);
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
 * Cookie-only 门禁：登录设备管理接口只认普通 Session Cookie。
 * 未登录 401；Bearer API 密钥（即使属于站长）一律 403——设备接口不是脚本接口。
 */
function requireCookieSession(c: Context): NonNullable<AppVariables['auth']> {
  const auth = c.get('auth');
  if (!auth) throw errors.unauthenticated();
  if (auth.viaApiKey) throw errors.forbidden('登录设备管理只支持浏览器/客户端会话，API 密钥无权访问');
  return auth;
}

/** 路径里的会话 ID 必须是合法 UUID。 */
function parseSessionId(raw: string): string {
  const result = z.uuid().safeParse(raw);
  if (!result.success) {
    throw errors.validation({ issues: [{ path: 'sessionId', message: '会话 ID 格式不正确' }] });
  }
  return result.data;
}