'use client';

export interface SessionUser {
  id: string;
  username: string;
  role: string;
  /** 头像图片地址（站内上传路径或外链），未设置时为 null。 */
  avatarPath?: string | null;
  /** 账号主题颜色（azure/pink/mint/orange/slate/none）；null = 从未设置。 */
  themeColour?: string | null;
  /** 账号明暗（auto/dark/light）；null = 从未设置。 */
  themeMode?: string | null;
}

/**
 * `/api/auth/me` 的完整结果。除了用户本身，还带着两个「能不能用」的状态：
 * 邮箱是否已验证、这台设备是否已确认 —— 前端据此渲染验证引导页。
 */
export interface SessionState {
  user: SessionUser | null;
  /** 本人邮箱（未登录为 undefined）：引导页要显示「发到了哪个地址」。 */
  email?: string;
  needsEmailVerification: boolean;
  pendingDevice: boolean;
  /** 未验证邮箱的自动注销时刻（ISO）；不需要验证时为 null。 */
  verificationGraceEndsAt: string | null;
  /** 提醒邮件间隔（小时）。 */
  verificationReminderHours: number;
}

const ANONYMOUS: SessionState = {
  user: null,
  needsEmailVerification: false,
  pendingDevice: false,
  verificationGraceEndsAt: null,
  verificationReminderHours: 6,
};

interface CacheEntry {
  at: number;
  state: SessionState;
}

let cached: CacheEntry | null = null;
let inflight: Promise<SessionState> | null = null;

/** 会话结果在页面内的复用窗口（毫秒）。 */
const TTL_MS = 10_000;

/**
 * 读取当前会话状态（用户 + 验证/设备闸门状态）。
 *
 * 头部导航、头像入口、访客弹窗、登录页提示都会用到它——同一页面内并发调用
 * 只发一次 `/api/auth/me` 请求，短时间内复用结果，避免每处各发一次造成的卡顿。
 */
export async function getSessionState(force = false): Promise<SessionState> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.state;
  if (!force && inflight) return inflight;

  inflight = (async () => {
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!response.ok) return ANONYMOUS;
      const json = (await response.json()) as {
        data?: {
          user?: SessionUser | null;
          email?: string;
          needsEmailVerification?: boolean;
          pendingDevice?: boolean;
          verificationGraceEndsAt?: string | null;
          verificationReminderHours?: number;
        };
      };
      const data = json.data;
      if (!data?.user) return ANONYMOUS;
      return {
        user: data.user,
        email: data.email,
        needsEmailVerification: data.needsEmailVerification === true,
        pendingDevice: data.pendingDevice === true,
        verificationGraceEndsAt: data.verificationGraceEndsAt ?? null,
        verificationReminderHours: data.verificationReminderHours ?? 6,
      };
    } catch {
      return ANONYMOUS;
    } finally {
      inflight = null;
    }
  })();

  const state = await inflight;
  cached = { at: Date.now(), state };
  return state;
}

/** 只要用户信息时的便捷入口（不需要验证状态的地方继续用它）。 */
export async function getSession(force = false): Promise<SessionUser | null> {
  return (await getSessionState(force)).user;
}

/** 登录 / 登出后清掉缓存，下一次读取一定拿最新会话。 */
export function invalidateSession(): void {
  cached = null;
}
