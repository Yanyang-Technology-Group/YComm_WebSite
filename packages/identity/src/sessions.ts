import { and, eq, gt, isNull } from 'drizzle-orm';
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