import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { AUTH } from '@ycomm/config';
import { newToken } from '@ycomm/kernel';

/** Human-shareable invite code, ~8 URL-safe characters. */
export function generateInviteCode(): string {
  return newToken(6);
}

export interface NewInviteCodeInput {
  code?: string;
  createdBy: string;
  note?: string;
  maxUses?: number;
  expiresAt?: Date;
}

export async function createInviteCode(db: Db, input: NewInviteCodeInput): Promise<string> {
  const code = input.code ?? generateInviteCode();
  await db.insert(schema.inviteCodes).values({
    code,
    created_by: input.createdBy,
    note: input.note ?? null,
    max_uses: input.maxUses ?? AUTH.inviteCodeDefaultMaxUses,
    expires_at: input.expiresAt ?? new Date(Date.now() + AUTH.inviteCodeDefaultTtlDays * 86400_000),
  });
  return code;
}

export interface ClaimedInvite {
  codeId: string;
  createdBy: string | null;
}

/**
 * Atomically claim one use of an invite code.
 *
 * The claim is a single conditional UPDATE ... RETURNING — there is no
 * read-then-write window, so two simultaneous registrations can never both
 * consume the last use of a code.
 */
export async function consumeInviteCode(db: Db, code: string, userId: string): Promise<ClaimedInvite | null> {
  const claimed = await db
    .update(schema.inviteCodes)
    .set({ used_count: sql`${schema.inviteCodes.used_count} + 1` })
    .where(
      and(
        eq(schema.inviteCodes.code, code),
        isNull(schema.inviteCodes.revoked_at),
        or(
          isNull(schema.inviteCodes.max_uses),
          lt(schema.inviteCodes.used_count, schema.inviteCodes.max_uses),
        ),
        or(isNull(schema.inviteCodes.expires_at), gt(schema.inviteCodes.expires_at, new Date())),
      ),
    )
    .returning({ id: schema.inviteCodes.id, created_by: schema.inviteCodes.created_by, code: schema.inviteCodes.code });

  const row = claimed[0];
  if (!row) return null;

  await db.insert(schema.inviteCodeUses).values({ invite_code_id: row.id, user_id: userId });
  return { codeId: row.id, createdBy: row.created_by };
}