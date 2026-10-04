import { and, desc, eq, isNull } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { schema, type Db } from '@ycomm/db';
import { describeDevice } from './sessions';

/**
 * 设备指纹：把 User-Agent 里的数字串（版本号）统一抹成 `#` 之后再取 sha256。
 *
 * 为什么抹掉数字：浏览器每几周就升一次版本（Chrome/154 → Chrome/155），
 * 直接哈希整串 UA 会把同一次升级当成「新设备」，用户每隔几周就要收一次确认邮件。
 * 抹掉版本号之后，「同一系统上的同一浏览器/客户端」会得到稳定指纹，而
 * Windows/Chrome 与 Linux/Firefox 仍然区分得开。
 *
 * 拿不到 UA（或者是迁移前建立的老会话）返回 null —— 调用方一律按「已信任」处理。
 */
export function deviceFingerprint(userAgent: string | null | undefined): string | null {
  const ua = userAgent?.trim();
  if (!ua) return null;
  const normalized = ua.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex');
}

export interface TrustedDeviceView {
  id: string;
  /** 展示名（由 User-Agent 推断），可能为空串。 */
  label: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

function toView(row: typeof schema.trustedDevices.$inferSelect): TrustedDeviceView {
  return {
    id: row.id,
    label: row.label || describeDevice(null),
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
  };
}

/** 该设备指纹是否已被这个账号确认过。没有指纹（老会话）视为已确认。 */
export async function isDeviceTrusted(
  db: Db,
  userId: string,
  deviceHash: string | null | undefined,
): Promise<boolean> {
  if (!deviceHash) return true;
  const rows = await db
    .select({ id: schema.trustedDevices.id })
    .from(schema.trustedDevices)
    .where(
      and(
        eq(schema.trustedDevices.user_id, userId),
        eq(schema.trustedDevices.device_hash, deviceHash),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * 记住一台设备（本人点了邮件里的确认链接之后才调用）。
 *
 * 幂等：同一设备重复确认只更新 label / last_seen_at。
 */
export async function trustDevice(
  db: Db,
  userId: string,
  deviceHash: string,
  label: string,
): Promise<void> {
  const now = new Date();
  await db
    .insert(schema.trustedDevices)
    .values({ user_id: userId, device_hash: deviceHash, label, last_seen_at: now })
    .onConflictDoUpdate({
      target: [schema.trustedDevices.user_id, schema.trustedDevices.device_hash],
      set: { label, last_seen_at: now },
    });
}

/** 该账号已确认的设备列表，最近使用的排前面。 */
export async function listTrustedDevices(db: Db, userId: string): Promise<TrustedDeviceView[]> {
  const rows = await db
    .select()
    .from(schema.trustedDevices)
    .where(eq(schema.trustedDevices.user_id, userId))
    .orderBy(desc(schema.trustedDevices.last_seen_at));
  return rows.map(toView);
}

/**
 * 撤销一台受信任设备：删掉信任行，并吊销该设备上所有还活着的会话。
 *
 * 撤销之后，那台设备下次登录会被当成新设备重新走邮箱确认 —— 这正是「把别人踢下线」
 * 的动作，所以顺手吊销会话，不能让撤销只影响下一次登录。
 */
export async function revokeTrustedDevice(db: Db, userId: string, deviceId: string): Promise<boolean> {
  const deleted = await db
    .delete(schema.trustedDevices)
    .where(and(eq(schema.trustedDevices.id, deviceId), eq(schema.trustedDevices.user_id, userId)))
    .returning({ deviceHash: schema.trustedDevices.device_hash });
  const deviceHash = deleted[0]?.deviceHash;
  if (!deviceHash) return false;

  await db
    .update(schema.sessions)
    .set({ revoked_at: new Date() })
    .where(
      and(
        eq(schema.sessions.user_id, userId),
        eq(schema.sessions.device_hash, deviceHash),
        isNull(schema.sessions.revoked_at),
      ),
    );
  return true;
}
