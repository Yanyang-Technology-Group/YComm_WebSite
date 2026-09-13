'use client';

export interface SessionUser {
  id: string;
  username: string;
  role: string;
}

interface CacheEntry {
  at: number;
  user: SessionUser | null;
}

let cached: CacheEntry | null = null;
let inflight: Promise<SessionUser | null> | null = null;

/** 会话结果在页面内的复用窗口（毫秒）。 */
const TTL_MS = 10_000;

/**
 * 读取当前登录用户。
 *
 * 头部导航、头像入口、访客弹窗、登录页提示都会用到它——同一页面内并发调用
 * 只发一次 `/api/auth/me` 请求，短时间内复用结果，避免每处各发一次造成的卡顿。
 */
export async function getSession(force = false): Promise<SessionUser | null> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.user;
  if (!force && inflight) return inflight;

  inflight = (async () => {
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!response.ok) return null;
      const json = (await response.json()) as { data?: { user?: SessionUser | null } };
      return json.data?.user ?? null;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();

  const user = await inflight;
  cached = { at: Date.now(), user };
  return user;
}

/** 登录 / 登出后清掉缓存，下一次读取一定拿最新会话。 */
export function invalidateSession(): void {
  cached = null;
}
