import { desc, eq, like, or, sql } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import { canAssignRole, FEATURE_DEFAULTS, type AssignableRole } from '@ycomm/config';
import { getSetting, setSetting } from '@ycomm/db';
import type { UserRecord } from './types';

/**
 * Admin-facing account operations.
 *
 * Every mutation checks rank (strictly higher wins) so an admin cannot touch
 * another admin and nobody touches the owner; role grants additionally go
 * through `config/roles.ts` `canAssignRole` (owner-only, never owner-for-owner).
 * Every action is audited.
 */

export interface AdminActor {
  id: string;
  role: AssignableRole;
}

async function canonicalActor(db: Db, actor: AdminActor): Promise<AdminActor> {
  const row = await db
    .select({ id: schema.users.id, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, actor.id))
    .limit(1);
  if (!row[0] || row[0].role !== actor.role) {
    // The session role changed under us — re-resolve rather than trust the token.
    throw errors.internal(undefined, 'actor role mismatch');
  }
  return { id: actor.id, role: row[0].role };
}

async function loadTarget(db: Db, targetId: string): Promise<UserRecord> {
  const rows = await db.select().from(schema.users).where(eq(schema.users.id, targetId)).limit(1);
  const target = rows[0];
  if (!target) throw errors.notFound('用户不存在');
  return target;
}

function rank(role: AssignableRole): number {
  return role === 'owner' ? 30 : role === 'admin' ? 20 : 10;
}

function requireRankAbove(actor: AdminActor, targetRole: AssignableRole): void {
  if (rank(actor.role) <= rank(targetRole)) {
    throw errors.forbidden('无权对该用户执行此操作');
  }
}

export interface UserListResult {
  users: UserRecord[];
  total: number;
}

export async function listUsers(
  db: Db,
  options: { q?: string; offset?: number; limit?: number } = {},
): Promise<UserListResult> {
  const limit = Math.min(options.limit ?? 20, 100);
  const q = options.q?.trim();

  const where = q
    ? or(
        like(sql`lower(${schema.users.username})`, `%${q.toLowerCase()}%`),
        like(sql`lower(${schema.users.email})`, `%${q.toLowerCase()}%`),
      )
    : undefined;

  const users = await db
    .select()
    .from(schema.users)
    .where(where)
    .orderBy(desc(schema.users.created_at))
    .limit(limit)
    .offset(options.offset ?? 0);

  const totals = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.users)
    .where(where);
  return { users, total: totals[0]?.n ?? 0 };
}

export async function setUserRole(
  db: Db,
  actorInput: AdminActor,
  targetId: string,
  role: AssignableRole,
): Promise<UserRecord> {
  const actor = await canonicalActor(db, actorInput);
  // Only the owner may grant; the role path never creates an owner.
  if (!canAssignRole(actor.role, role)) {
    throw errors.forbidden('只有站长可以授予或撤销角色');
  }
  const target = await loadTarget(db, targetId);
  if (target.role === 'owner') {
    throw errors.forbidden('不能变更站长角色');
  }

  const [updated] = await db
    .update(schema.users)
    .set({ role, updated_at: new Date() })
    .where(eq(schema.users.id, targetId))
    .returning();
  if (!updated) throw errors.internal(undefined, 'role update failed');

  await db.insert(schema.auditLogs).values({
    actor_id: actor.id,
    action: 'admin.user.role_changed',
    target_type: 'user',
    target_id: targetId,
    meta: { from: target.role, to: role },
  });
  return updated;
}

export async function banUser(
  db: Db,
  actorInput: AdminActor,
  targetId: string,
  reason?: string,
): Promise<UserRecord> {
  const actor = await canonicalActor(db, actorInput);
  const target = await loadTarget(db, targetId);
  requireRankAbove(actor, target.role);

  const [updated] = await db
    .update(schema.users)
    .set({ state: 'banned', ban_reason: reason ?? null, updated_at: new Date() })
    .where(eq(schema.users.id, targetId))
    .returning();
  if (!updated) throw errors.internal(undefined, 'ban failed');

  await db.insert(schema.userSanctions).values({
    user_id: targetId,
    kind: 'ban',
    reason: reason ?? '',
    issued_by: actor.id,
    starts_at: new Date(),
  });
  await db.insert(schema.auditLogs).values({
    actor_id: actor.id,
    action: 'admin.user.banned',
    target_type: 'user',
    target_id: targetId,
    meta: { reason: reason ?? null },
  });
  return updated;
}

export async function unbanUser(db: Db, actorInput: AdminActor, targetId: string): Promise<UserRecord> {
  const actor = await canonicalActor(db, actorInput);
  const target = await loadTarget(db, targetId);
  requireRankAbove(actor, target.role);

  const [updated] = await db
    .update(schema.users)
    .set({ state: 'active', ban_reason: null, updated_at: new Date() })
    .where(eq(schema.users.id, targetId))
    .returning();
  if (!updated) throw errors.internal(undefined, 'unban failed');

  await db.insert(schema.auditLogs).values({
    actor_id: actor.id,
    action: 'admin.user.unbanned',
    target_type: 'user',
    target_id: targetId,
  });
  return updated;
}

export async function muteUser(
  db: Db,
  actorInput: AdminActor,
  targetId: string,
  options: { until?: Date | null; reason?: string } = {},
): Promise<UserRecord> {
  const actor = await canonicalActor(db, actorInput);
  const target = await loadTarget(db, targetId);
  requireRankAbove(actor, target.role);

  const [updated] = await db
    .update(schema.users)
    .set({
      state: 'muted',
      muted_until: options.until ?? null,
      mute_reason: options.reason ?? null,
      updated_at: new Date(),
    })
    .where(eq(schema.users.id, targetId))
    .returning();
  if (!updated) throw errors.internal(undefined, 'mute failed');

  await db.insert(schema.userSanctions).values({
    user_id: targetId,
    kind: 'mute',
    reason: options.reason ?? '',
    issued_by: actor.id,
    starts_at: new Date(),
    ends_at: options.until ?? null,
  });
  await db.insert(schema.auditLogs).values({
    actor_id: actor.id,
    action: 'admin.user.muted',
    target_type: 'user',
    target_id: targetId,
    meta: { until: options.until ? options.until.toISOString() : null },
  });
  return updated;
}

export async function unmuteUser(db: Db, actorInput: AdminActor, targetId: string): Promise<UserRecord> {
  const actor = await canonicalActor(db, actorInput);
  const target = await loadTarget(db, targetId);
  requireRankAbove(actor, target.role);

  const [updated] = await db
    .update(schema.users)
    .set({ state: 'active', muted_until: null, mute_reason: null, updated_at: new Date() })
    .where(eq(schema.users.id, targetId))
    .returning();
  if (!updated) throw errors.internal(undefined, 'unmute failed');

  await db.insert(schema.auditLogs).values({
    actor_id: actor.id,
    action: 'admin.user.unmuted',
    target_type: 'user',
    target_id: targetId,
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Runtime settings
// ---------------------------------------------------------------------------

export async function listRuntimeSettings(db: Db): Promise<Array<{ key: string; value: unknown }>> {
  const rows = await db.select({ key: schema.settings.key, value: schema.settings.value }).from(schema.settings).orderBy(schema.settings.key);
  return rows;
}

/** Runtime settings an admin may edit. Feature switches plus moderation lists. */
const EDITABLE_SETTING_KEYS: ReadonlySet<string> = new Set([
  ...Object.keys(FEATURE_DEFAULTS),
  // 违禁词（forum 模块读取；forum 包不反向依赖 identity，故此处内联键名）
  'bannedWords',
]);

/** Update a settings key; unknown keys are rejected so typos cannot invent settings. */
export async function setRuntimeSetting(
  db: Db,
  actor: AdminActor,
  key: string,
  value: unknown,
): Promise<void> {
  if (!EDITABLE_SETTING_KEYS.has(key)) {
    throw errors.validation({ issues: [{ path: 'key', message: `未知的设置项: ${key}` }] });
  }
  await setSetting(db, key, value, actor.id);
  await db.insert(schema.auditLogs).values({
    actor_id: actor.id,
    action: 'admin.settings.updated',
    meta: { key, value: serializeForAudit(value) },
  });
}

export function serializeForAudit(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return '[unserializable]';
  }
}

export async function getRuntimeSetting(db: Db, key: string): Promise<unknown | undefined> {
  return getSetting(db, key);
}