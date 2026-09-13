import { count, eq, or, sql } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import type { PublicUser, UserRecord } from './types';

/** The exact view of a user that may leave the API layer. */
export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    level: user.level,
    state: user.state,
    avatarPath: user.avatar_path,
    bio: user.bio,
    createdAt: user.created_at,
  };
}

/**
 * Step ① of the access decision chain — the account state gate.
 *
 * Runs for every authenticated action. `requireVerified` is normally true; the
 * login endpoint itself may pass false so an unverified user can sign in and
 * complete verification.
 */
export function assertAccountCanAct(
  user: UserRecord,
  options: { requireVerified?: boolean } = {},
): void {
  const requireVerified = options.requireVerified ?? true;

  if (user.state === 'deleted') {
    throw errors.forbidden('账号已注销');
  }
  if (user.state === 'banned') {
    throw errors.accountBanned(user.ban_reason);
  }
  if (user.state === 'muted') {
    const mutedUntil = user.muted_until;
    if (mutedUntil === null || mutedUntil > new Date()) {
      throw errors.accountMuted(mutedUntil);
    }
  }
  if (requireVerified && user.state === 'unverified') {
    throw errors.accountUnverified();
  }
}

/** A site with zero users has not been bootstrapped yet. */
export async function hasAnyUser(db: Db): Promise<boolean> {
  const rows = await db.select({ total: count() }).from(schema.users);
  return (rows[0]?.total ?? 0) > 0;
}

export async function findUserByLogin(db: Db, login: string): Promise<UserRecord | null> {
  const normalized = login.trim();
  const rows = await db
    .select()
    .from(schema.users)
    .where(
      or(
        eq(sql`lower(${schema.users.username})`, normalized.toLowerCase()),
        eq(sql`lower(${schema.users.email})`, normalized.toLowerCase()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findUserByEmail(db: Db, email: string): Promise<UserRecord | null> {
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(sql`lower(${schema.users.email})`, email.trim().toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
}