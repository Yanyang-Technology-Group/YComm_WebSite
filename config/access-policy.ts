import { z } from 'zod';
import { MAX_LEVEL } from './policy';

/**
 * The shape of an access policy, stored as `jsonb` on boards, download
 * categories and download resources.
 *
 * This is the answer to "can this person see this thing", and it is deliberately
 * separate from roles: a role says what you are allowed to do, a policy says what
 * the resource allows. Evaluating the two together is the job of the access
 * decision chain in `packages/access`.
 *
 * ⚠️ The invite requirement lives *here*, per resource — not in the registration
 * flow. A single invite mechanism therefore guards both "this board needs an
 * invite" and "this download needs an invite", and the two can never drift apart.
 */

export const ACCESS_VISIBILITIES = ['public', 'login', 'invite'] as const;
export type AccessVisibility = (typeof ACCESS_VISIBILITIES)[number];

export const accessPolicySchema = z.object({
  /** `public` = readable while signed out, `login` = any verified member. */
  visibility: z.enum(ACCESS_VISIBILITIES).default('login'),
  /** Minimum level required. 0 disables the level gate entirely. */
  minLevel: z.number().int().min(0).max(MAX_LEVEL).default(0),
  /**
   * When true the subject must hold an `access_grants` row for this resource,
   * earned by redeeming an invite code. Independent of `visibility`.
   */
  requireInvite: z.boolean().default(false),
});

export type AccessPolicy = z.infer<typeof accessPolicySchema>;

export const DEFAULT_BOARD_POLICY: AccessPolicy = accessPolicySchema.parse({});

export const DEFAULT_DOWNLOAD_CATEGORY_POLICY: AccessPolicy = accessPolicySchema.parse({
  visibility: 'login',
});

export const DEFAULT_RESOURCE_POLICY: AccessPolicy = accessPolicySchema.parse({
  visibility: 'login',
});

/**
 * Parse a policy that came out of the database or a form.
 *
 * Unknown keys are stripped rather than rejected so that removing a policy field
 * in a future release does not make every stored row unreadable.
 */
export function parseAccessPolicy(input: unknown): AccessPolicy {
  return accessPolicySchema.parse(input ?? {});
}

/** Non-throwing variant for read paths that must not fail on legacy rows. */
export function safeParseAccessPolicy(input: unknown): AccessPolicy {
  const result = accessPolicySchema.safeParse(input ?? {});
  return result.success ? result.data : DEFAULT_BOARD_POLICY;
}

export const ACCESS_VISIBILITY_LABELS: Record<AccessVisibility, string> = {
  public: '所有人可读',
  login: '需登录',
  invite: '需邀请码',
};

/**
 * Human-readable summary of a policy, used in the admin UI and in denial
 * messages. Keeping this next to the type means a new policy field cannot be
 * added without the description following along.
 */
export function describeAccessPolicy(policy: AccessPolicy): string {
  const parts: string[] = [ACCESS_VISIBILITY_LABELS[policy.visibility]];
  if (policy.minLevel > 0) parts.push(`等级 ≥ Lv${policy.minLevel}`);
  if (policy.requireInvite) parts.push('需邀请码解锁');
  return parts.join(' · ');
}

/** True when the policy restricts access in any way beyond anonymous reading. */
export function isRestrictedPolicy(policy: AccessPolicy): boolean {
  return policy.visibility !== 'public' || policy.minLevel > 0 || policy.requireInvite;
}
