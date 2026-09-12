import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { errors, type AppError } from '@ycomm/kernel';
import { ROLE_RANK, roleHasPermission, type AssignableRole, type Permission } from '@ycomm/config';

/**
 * The compact shape every access decision needs. Built by the API layer from
 * the full session user record; never serialized to clients as-is (only the
 * public view is).
 */
export interface AccessSubject {
  id: string;
  role: AssignableRole;
  level: number;
  state: 'unverified' | 'active' | 'muted' | 'banned' | 'deleted';
  mutedUntil: Date | null;
  banReason: string | null;
}

export interface AccessPolicyLike {
  visibility: 'public' | 'login' | 'invite';
  minLevel: number;
  requireInvite: boolean;
}

export interface ResourceLike {
  type: 'board' | 'download_category' | 'download_resource';
  id: string;
  policy: AccessPolicyLike;
}

/**
 * ① The account state gate.
 *
 * Runs before every authenticated action. Guests have no state — the policy and
 * permission gates below are what stop them. `requireVerified: false` is only
 * for the login/verification flows themselves.
 */
export function assertSubjectCanAct(
  subject: AccessSubject | null,
  options: { requireVerified?: boolean } = {},
): void {
  if (!subject) return;
  const requireVerified = options.requireVerified ?? true;

  if (subject.state === 'deleted') {
    throw errors.forbidden('账号已注销');
  }
  if (subject.state === 'banned') {
    throw errors.accountBanned(subject.banReason);
  }
  if (subject.state === 'muted') {
    if (subject.mutedUntil === null || subject.mutedUntil > new Date()) {
      throw errors.accountMuted(subject.mutedUntil);
    }
  }
  if (requireVerified && subject.state === 'unverified') {
    throw errors.accountUnverified();
  }
}

/**
 * ② The resource policy gate.
 *
 * Decides whether a *subject* may even SEE a resource. Invite-locked resources
 * require an `access_grants` row unless the subject is admin/owner (staff
 * override — they manage the resource, locking them out would be absurd).
 */

/** Returns the AppError a view would be denied with, or null when allowed. */
async function viewError(
  db: Db,
  subject: AccessSubject | null,
  resource: ResourceLike,
): Promise<AppError | null> {
  if (!subject) {
    if (resource.policy.visibility === 'public') return null;
    return errors.loginRequired();
  }

  if (resource.policy.visibility === 'invite') {
    const staffOverride = subject.role === 'admin' || subject.role === 'owner';
    if (!staffOverride) {
      const grants = await db
        .select({ id: schema.accessGrants.id })
        .from(schema.accessGrants)
        .where(
          and(
            eq(schema.accessGrants.user_id, subject.id),
            eq(schema.accessGrants.resource_type, resource.type),
            eq(schema.accessGrants.resource_id, resource.id),
          ),
        )
        .limit(1);
      if (grants.length === 0) {
        return errors.inviteRequired();
      }
    }
  }

  if (resource.policy.minLevel > 0 && subject.level < resource.policy.minLevel) {
    return errors.levelTooLow(resource.policy.minLevel, subject.level);
  }

  return null;
}

/** Non-throwing variant for listings and pre-checks. */
export async function canViewResource(
  db: Db,
  subject: AccessSubject | null,
  resource: ResourceLike,
): Promise<boolean> {
  return (await viewError(db, subject, resource)) === null;
}

/** Throwing variant for single-object reads. */
export async function assertCanViewResource(
  db: Db,
  subject: AccessSubject | null,
  resource: ResourceLike,
): Promise<void> {
  const error = await viewError(db, subject, resource);
  if (error) throw error;
}

/**
 * ③ The permission gate (role → permission points, config/roles.ts).
 */
export function assertPermission(subject: AccessSubject | null, permission: Permission): void {
  if (!subject) {
    throw errors.loginRequired();
  }
  if (!roleHasPermission(subject.role, permission)) {
    throw errors.forbidden('权限不足');
  }
}

/**
 * Rank gate for acting on OTHER users: strictly higher rank wins, so an admin
 * can never touch another admin and nobody touches the owner.
 */
export function assertCanActOnRole(subject: AccessSubject, targetRole: AssignableRole): void {
  if (ROLE_RANK[subject.role] <= ROLE_RANK[targetRole]) {
    throw errors.forbidden('无权对该用户执行此操作');
  }
}

/** Grant access to an invite-locked resource (redeemed invite code, admin grant). */
export async function grantAccess(
  db: Db,
  input: {
    userId: string;
    resourceType: string;
    resourceId: string;
    via: 'invite_code' | 'admin' | 'purchase';
    grantedBy?: string | null;
    expiresAt?: Date | null;
  },
): Promise<void> {
  await db
    .insert(schema.accessGrants)
    .values({
      user_id: input.userId,
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      granted_via: input.via,
      granted_by: input.grantedBy ?? null,
      expires_at: input.expiresAt ?? null,
    })
    .onConflictDoNothing();
}