import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { AUTH } from '@ycomm/config';
import { errors, newToken } from '@ycomm/kernel';

/** Human-shareable invite code, ~8 URL-safe characters. */
export function generateInviteCode(): string {
  return newToken(6);
}

/** 管理员创建注册码时允许的字符与长度上限（用户要求：≤10 位）。 */
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{2,10}$/;
export const INVITE_NAME_MAX_LENGTH = 60;

export interface NewInviteCodeInput {
  code?: string;
  createdBy: string;
  note?: string;
  maxUses?: number;
  expiresAt?: Date;
}

export async function createInviteCode(db: Db, input: NewInviteCodeInput): Promise<string> {
  const code = normalizeInviteCode(input.code);
  await db.insert(schema.inviteCodes).values({
    code,
    created_by: input.createdBy,
    note: input.note ?? null,
    max_uses: input.maxUses ?? AUTH.inviteCodeDefaultMaxUses,
    expires_at: input.expiresAt ?? new Date(Date.now() + AUTH.inviteCodeDefaultTtlDays * 86400_000),
  });
  return code;
}

function normalizeInviteCode(code?: string): string {
  const normalized = (code ?? generateInviteCode()).trim();
  if (!INVITE_CODE_PATTERN.test(normalized)) {
    throw errors.validation({
      issues: [
        {
          path: 'code',
          message: '注册码为 2-10 位，仅限字母、数字、下划线、连字符（留空则自动生成）',
        },
      ],
    });
  }
  return normalized;
}

export interface AdminInviteCodeInput {
  /** 名称（展示用），映射到 inviteCodes.note */
  name: string;
  /** 注册码，可选（留空自动生成 8 位） */
  code?: string;
  /** 最多可绑定/使用的账号数；缺省用 AUTH.inviteCodeDefaultMaxUses（默认 1）。 */
  maxUses?: number;
  createdBy: string;
}

export interface InviteCodeRow {
  id: string;
  name: string | null;
  code: string;
  createdByUsername: string | null;
  usedCount: number;
  maxUses: number | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

/**
 * 管理员创建注册码：`name` 必填（≤60 字），`code` 可选（≤10 位，留空自动生成）。
 */
export async function adminCreateInviteCode(db: Db, input: AdminInviteCodeInput): Promise<InviteCodeRow> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > INVITE_NAME_MAX_LENGTH) {
    throw errors.validation({
      issues: [{ path: 'name', message: `名称长度为 1-${INVITE_NAME_MAX_LENGTH} 字` }],
    });
  }
  const code = normalizeInviteCode(input.code);
  await db.insert(schema.inviteCodes).values({
    code,
    created_by: input.createdBy,
    note: name,
    max_uses: input.maxUses ?? AUTH.inviteCodeDefaultMaxUses,
  });
  const row = await getInviteCodeRows(db, code);
  return row[0] as InviteCodeRow;
}

export async function listInviteCodes(db: Db): Promise<InviteCodeRow[]> {
  const rows = await db
    .select({
      id: schema.inviteCodes.id,
      name: schema.inviteCodes.note,
      code: schema.inviteCodes.code,
      createdByUsername: schema.users.username,
      usedCount: schema.inviteCodes.used_count,
      maxUses: schema.inviteCodes.max_uses,
      createdAt: schema.inviteCodes.created_at,
      expiresAt: schema.inviteCodes.expires_at,
      revokedAt: schema.inviteCodes.revoked_at,
    })
    .from(schema.inviteCodes)
    .leftJoin(schema.users, eq(schema.inviteCodes.created_by, schema.users.id))
    .orderBy(sql`${schema.inviteCodes.created_at} desc`);
  return rows as InviteCodeRow[];
}

async function getInviteCodeRows(db: Db, code: string): Promise<InviteCodeRow[]> {
  const rows = await db
    .select({
      id: schema.inviteCodes.id,
      name: schema.inviteCodes.note,
      code: schema.inviteCodes.code,
      createdByUsername: schema.users.username,
      usedCount: schema.inviteCodes.used_count,
      maxUses: schema.inviteCodes.max_uses,
      createdAt: schema.inviteCodes.created_at,
      expiresAt: schema.inviteCodes.expires_at,
      revokedAt: schema.inviteCodes.revoked_at,
    })
    .from(schema.inviteCodes)
    .leftJoin(schema.users, eq(schema.inviteCodes.created_by, schema.users.id))
    .where(eq(schema.inviteCodes.code, code))
    .limit(1);
  return rows as InviteCodeRow[];
}

/** 删除注册码（连带删除其使用记录）。 */
export async function deleteInviteCode(db: Db, id: string): Promise<void> {
  const deleted = await db
    .delete(schema.inviteCodes)
    .where(eq(schema.inviteCodes.id, id))
    .returning({ id: schema.inviteCodes.id });
  if (deleted.length === 0) {
    throw errors.notFound('注册码不存在');
  }
}

/** 单条注册码（按 id），用于创建/修改后回显。 */
async function getInviteCodeRowById(db: Db, id: string): Promise<InviteCodeRow | null> {
  const rows = await db
    .select({
      id: schema.inviteCodes.id,
      name: schema.inviteCodes.note,
      code: schema.inviteCodes.code,
      createdByUsername: schema.users.username,
      usedCount: schema.inviteCodes.used_count,
      maxUses: schema.inviteCodes.max_uses,
      createdAt: schema.inviteCodes.created_at,
      expiresAt: schema.inviteCodes.expires_at,
      revokedAt: schema.inviteCodes.revoked_at,
    })
    .from(schema.inviteCodes)
    .leftJoin(schema.users, eq(schema.inviteCodes.created_by, schema.users.id))
    .where(eq(schema.inviteCodes.id, id))
    .limit(1);
  return (rows[0] as InviteCodeRow | undefined) ?? null;
}

/**
 * 修改注册码的可绑定账号数（数量）。
 * 不能小于已经用掉的数量（否则已绑定的人会超过上限）。
 */
export async function updateInviteCodeMaxUses(db: Db, id: string, maxUses: number): Promise<InviteCodeRow> {
  const [row] = await db.select().from(schema.inviteCodes).where(eq(schema.inviteCodes.id, id)).limit(1);
  if (!row) throw errors.notFound('注册码不存在');
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100_000) {
    throw errors.validation({ issues: [{ path: 'maxUses', message: '数量需为 1-100000 的整数' }] });
  }
  if (maxUses < row.used_count) {
    throw errors.validation({
      issues: [{ path: 'maxUses', message: `不能小于已被绑定的 ${row.used_count} 个` }],
    });
  }
  await db.update(schema.inviteCodes).set({ max_uses: maxUses }).where(eq(schema.inviteCodes.id, id));
  const updated = await getInviteCodeRowById(db, id);
  if (!updated) throw errors.notFound('注册码不存在');
  return updated;
}

/**
 * 解绑某个用户绑定的注册码（管理员操作）。
 * 删掉使用记录并把该注册码的名额还回去（used_count -1），用户之后可以重新绑定。
 * 没绑定时幂等成功。
 */
export async function unbindInviteCode(db: Db, userId: string): Promise<{ code: string | null }> {
  const rows = await db
    .select({ useId: schema.inviteCodeUses.id, codeId: schema.inviteCodes.id, code: schema.inviteCodes.code })
    .from(schema.inviteCodeUses)
    .innerJoin(schema.inviteCodes, eq(schema.inviteCodeUses.invite_code_id, schema.inviteCodes.id))
    .where(eq(schema.inviteCodeUses.user_id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return { code: null };

  await db.transaction(async (tx) => {
    await tx.delete(schema.inviteCodeUses).where(eq(schema.inviteCodeUses.id, row.useId));
    await tx
      .update(schema.inviteCodes)
      .set({ used_count: sql`greatest(${schema.inviteCodes.used_count} - 1, 0)` })
      .where(eq(schema.inviteCodes.id, row.codeId));
  });
  return { code: row.code };
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