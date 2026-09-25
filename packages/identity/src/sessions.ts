import { and, eq, gt, isNull, lt, ne, or } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { getEnv, hashToken, newToken } from '@ycomm/kernel';
import type { SessionWithUser } from './types';

export interface NewSession {
  /** The raw token handed to the client. Stored hashed, never in plaintext. */
  rawToken: string;
  expiresAt: Date;
}

export async function createSession(
  db: Db,
  input: { userId: string; ip?: string; userAgent?: string; ttlDays?: number },
): Promise<NewSession> {
  const env = getEnv();
  const rawToken = newToken(32);
  // 登录「记住我」= 15 天免登录；不记住时用环境默认（浏览器会话 cookie 由 API 层决定）。
  const ttlDays = input.ttlDays ?? env.SESSION_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  await db.insert(schema.sessions).values({
    token_hash: hashToken(rawToken),
    user_id: input.userId,
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null,
    expires_at: expiresAt,
  });

  // 登录即记录「最后登录时间」（管理后台的用户详情里显示；以前这一列从没被写过，永远是「未记录」）。
  await db
    .update(schema.users)
    .set({ last_seen_at: new Date() })
    .where(eq(schema.users.id, input.userId));

  return { rawToken, expiresAt };
}

/**
 * Resolve a session token to its user. Returns null for unknown, revoked or
 * expired sessions — the caller decides whether that is an error.
 */
export async function findSessionByToken(db: Db, rawToken: string): Promise<SessionWithUser | null> {
  const tokenHash = hashToken(rawToken);
  const rows = await db
    .select()
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.user_id, schema.users.id))
    .where(
      and(
        eq(schema.sessions.token_hash, tokenHash),
        isNull(schema.sessions.revoked_at),
        gt(schema.sessions.expires_at, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { session: row.sessions, user: row.users };
}

export async function revokeSession(db: Db, rawToken: string): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revoked_at: new Date() })
    .where(eq(schema.sessions.token_hash, hashToken(rawToken)));
}

/** Revoke every live session — used on password change/reset. */
export async function revokeAllSessionsForUser(db: Db, userId: string): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revoked_at: new Date() })
    .where(and(eq(schema.sessions.user_id, userId), isNull(schema.sessions.revoked_at)));
}

// ---- 登录设备管理（个人会话列表与远程退出） ------------------------------

/**
 * 对外可见的会话摘要。一次登录 = 一条会话；只含展示字段——
 * 绝不携带 token_hash / rawToken 或任何可重放的凭据。
 */
export interface SessionView {
  id: string;
  /** 由 User-Agent 推断的简短展示名称；仅用于显示，不参与鉴权。 */
  device: string;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  isCurrent: boolean;
}

const UNKNOWN_DEVICE = '未知设备';
const DEVICE_MAX_LENGTH = 80;

function truncateDeviceName(name: string): string {
  return name.length <= DEVICE_MAX_LENGTH ? name : name.slice(0, DEVICE_MAX_LENGTH);
}

/**
 * 从 User-Agent 推断展示名称，仅用于列表显示。
 *
 * 不引入第三方 UA 解析库：识别自有 Flutter 客户端（固定格式
 * `YCommFlutter/<平台>`）与常见浏览器/系统组合，认不出就用「未知设备」。
 */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent?.trim();
  if (!ua) return UNKNOWN_DEVICE;

  // Flutter 原生请求：YCommFlutter/Android、YCommFlutter/iOS —— 不含个人信息。
  const appMatch = /^YCommFlutter\/([\w.-]{1,32})/i.exec(ua);
  if (appMatch) return truncateDeviceName(`YComm 客户端 · ${appMatch[1]}`);

  const browser = /\bEdg(?:e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /\bOPR\/|\bOpera\//.test(ua)
      ? 'Opera'
      : /\bChrome\/|\bCriOS\//.test(ua)
        ? 'Chrome'
        : /\bFirefox\/|\bFxiOS\//.test(ua)
          ? 'Firefox'
          : /\bSafari\//.test(ua)
            ? 'Safari'
            : /\bMSIE |\bTrident\//.test(ua)
              ? 'IE'
              : null;

  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iOS/.test(ua)
        ? 'iOS'
        : /iPad/.test(ua)
          ? 'iPad'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'macOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;

  const parts = [browser, os].filter(Boolean);
  if (parts.length === 0) return UNKNOWN_DEVICE;
  return truncateDeviceName(parts.join(' · '));
}

function toSessionView(row: typeof schema.sessions.$inferSelect, currentSessionId: string): SessionView {
  return {
    id: row.id,
    device: describeDevice(row.user_agent),
    // 「unknown」是未信任代理头时的占位 IP，不当真实地址展示。
    ip: row.ip && row.ip !== 'unknown' ? row.ip : null,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
    expiresAt: row.expires_at.toISOString(),
    isCurrent: row.id === currentSessionId,
  };
}

/**
 * 当前账号的有效会话列表：当前会话排第一，其余按最近活跃
 * （无记录看创建时间）倒序。只含本人、未撤销、未过期的会话。
 */
export async function listActiveSessionsForUser(
  db: Db,
  userId: string,
  currentSessionId: string,
): Promise<SessionView[]> {
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.user_id, userId),
        isNull(schema.sessions.revoked_at),
        gt(schema.sessions.expires_at, new Date()),
      ),
    );

  const views = rows.map((row) => toSessionView(row, currentSessionId));
  views.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return Date.parse(b.lastUsedAt ?? b.createdAt) - Date.parse(a.lastUsedAt ?? a.createdAt);
  });
  return views;
}

/**
 * 撤销本账号的一条「其他」有效会话。
 *
 * 命中条件同时限定 user_id、排除当前会话、且目标未撤销未过期——
 * 当前会话（用退出登录）、他人的会话、失效目标一律返回 false。
 */
export async function revokeOtherSessionForUser(
  db: Db,
  userId: string,
  currentSessionId: string,
  targetSessionId: string,
): Promise<boolean> {
  const revoked = await db
    .update(schema.sessions)
    .set({ revoked_at: new Date() })
    .where(
      and(
        eq(schema.sessions.id, targetSessionId),
        eq(schema.sessions.user_id, userId),
        ne(schema.sessions.id, currentSessionId),
        isNull(schema.sessions.revoked_at),
        gt(schema.sessions.expires_at, new Date()),
      ),
    )
    .returning({ id: schema.sessions.id });
  return revoked.length > 0;
}

/** 一键撤销本账号除当前会话外的全部有效会话；返回实际撤销数量（重复调用为 0）。 */
export async function revokeOtherSessionsForUser(
  db: Db,
  userId: string,
  currentSessionId: string,
): Promise<number> {
  const revoked = await db
    .update(schema.sessions)
    .set({ revoked_at: new Date() })
    .where(
      and(
        eq(schema.sessions.user_id, userId),
        ne(schema.sessions.id, currentSessionId),
        isNull(schema.sessions.revoked_at),
        gt(schema.sessions.expires_at, new Date()),
      ),
    )
    .returning({ id: schema.sessions.id });
  return revoked.length;
}

/** 「最近活跃」写入节流窗口：5 分钟内的请求不再写库。 */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 刷新会话的最近使用时间（带节流）。
 *
 * `lastUsedAt` 是调用方刚读到的值：5 分钟内直接跳过写库。真正写入时再带
 * 时间条件（`last_used_at` 为空或早于截止点），并发请求即使都拿着同一份
 * 陈旧读数，也只会有一次写入生效，不会把新的时间改旧。
 */
export async function touchSessionIfStale(
  db: Db,
  sessionId: string,
  lastUsedAt: Date | null,
): Promise<void> {
  if (lastUsedAt && Date.now() - lastUsedAt.getTime() < TOUCH_INTERVAL_MS) return;
  const cutoff = new Date(Date.now() - TOUCH_INTERVAL_MS);
  await db
    .update(schema.sessions)
    .set({ last_used_at: new Date() })
    .where(
      and(
        eq(schema.sessions.id, sessionId),
        or(isNull(schema.sessions.last_used_at), lt(schema.sessions.last_used_at, cutoff)),
      ),
    );
}