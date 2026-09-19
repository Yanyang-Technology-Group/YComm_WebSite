import { and, desc, eq, isNull, or, gt } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { errors, hashToken, newToken } from '@ycomm/kernel';
import type { UserRecord } from './types';

/**
 * 开放 API 密钥（**仅站长 owner**）。
 *
 * - 明文只在创建时返回一次；库里存 sha256；
 * - 用 `Authorization: Bearer <key>` 调用接口时，身份等同该 owner；
 * - 支持只读 key、过期时间、撤销，以及「最近使用时间」。
 */

const PREFIX = 'ycomm_';

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  readOnly: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedApiKey extends ApiKeyView {
  /** 明文密钥：只在创建时返回一次，之后无法再取。 */
  key: string;
}

function toView(row: typeof schema.apiKeys.$inferSelect): ApiKeyView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    readOnly: row.read_only,
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

/** 创建密钥（仅 owner；调用方负责校验角色）。 */
export async function createApiKey(
  db: Db,
  owner: Pick<UserRecord, 'id' | 'role'>,
  input: { name: string; readOnly?: boolean; expiresInDays?: number | null },
): Promise<CreatedApiKey> {
  if (owner.role !== 'owner') {
    throw errors.forbidden('只有站长可以创建 API 密钥');
  }
  const name = input.name.trim();
  if (name.length < 1 || name.length > 60) {
    throw errors.validation({ issues: [{ path: 'name', message: '名称长度为 1-60 字' }] });
  }
  const raw = `${PREFIX}${newToken(32)}`;
  const expiresAt =
    input.expiresInDays && input.expiresInDays > 0
      ? new Date(Date.now() + input.expiresInDays * 86400_000)
      : null;

  const [row] = await db
    .insert(schema.apiKeys)
    .values({
      name,
      prefix: raw.slice(0, 14),
      key_hash: hashToken(raw),
      user_id: owner.id,
      read_only: input.readOnly ?? false,
      expires_at: expiresAt,
    })
    .returning();
  if (!row) throw errors.internal(undefined, 'API 密钥创建失败');
  return { ...toView(row), key: raw };
}

/** 列出全部密钥（不含明文）。 */
export async function listApiKeys(db: Db): Promise<ApiKeyView[]> {
  const rows = await db.select().from(schema.apiKeys).orderBy(desc(schema.apiKeys.created_at));
  return rows.map(toView);
}

/** 撤销密钥（幂等）。 */
export async function revokeApiKey(db: Db, keyId: string): Promise<void> {
  const revoked = await db
    .update(schema.apiKeys)
    .set({ revoked_at: new Date() })
    .where(and(eq(schema.apiKeys.id, keyId), isNull(schema.apiKeys.revoked_at)))
    .returning({ id: schema.apiKeys.id });
  if (revoked.length === 0) {
    // 已经撤销过也算成功；完全不存在才报错
    const rows = await db.select({ id: schema.apiKeys.id }).from(schema.apiKeys).where(eq(schema.apiKeys.id, keyId)).limit(1);
    if (rows.length === 0) throw errors.notFound('密钥不存在');
  }
}

export interface ApiKeyAuthResult {
  user: UserRecord;
  keyId: string;
  readOnly: boolean;
  /** 该密钥上次被使用的时间（用于一分钟节流）。 */
  lastUsedAt: Date | null;
}

/**
 * 用明文密钥鉴权：返回归属用户（必须是 owner），否则 null。
 * 撤销/过期/用户已不是 owner 都视为无效。
 */
export async function authenticateApiKey(db: Db, rawKey: string): Promise<ApiKeyAuthResult | null> {
  const key = rawKey.trim();
  if (!key.startsWith(PREFIX)) return null;

  const rows = await db
    .select({ key: schema.apiKeys, user: schema.users })
    .from(schema.apiKeys)
    .innerJoin(schema.users, eq(schema.apiKeys.user_id, schema.users.id))
    .where(
      and(
        eq(schema.apiKeys.key_hash, hashToken(key)),
        isNull(schema.apiKeys.revoked_at),
        or(isNull(schema.apiKeys.expires_at), gt(schema.apiKeys.expires_at, new Date())),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  // 只认站长：owner 转让后，旧 key 立即失效。
  if (row.user.role !== 'owner' || row.user.state === 'deleted' || row.user.state === 'banned') return null;
  return { user: row.user, keyId: row.key.id, readOnly: row.key.read_only, lastUsedAt: row.key.last_used_at };
}

/** 记录最近使用时间（一分钟内的重复调用不再写库，避免每次请求都 UPDATE）。 */
export async function touchApiKey(db: Db, keyId: string, lastUsedAt: Date | null): Promise<void> {
  if (lastUsedAt && Date.now() - lastUsedAt.getTime() < 60_000) return;
  await db.update(schema.apiKeys).set({ last_used_at: new Date() }).where(eq(schema.apiKeys.id, keyId));
}