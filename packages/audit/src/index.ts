import { desc, eq, like, sql } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';

export interface AuditEntry {
  /** Null for system-initiated actions. */
  actorId?: string | null;
  actorIp?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  /**
   * Structured detail. Never carry secrets into `meta` — nothing here is
   * redacted automatically (the log *is* the record).
   */
  meta?: Record<string, unknown>;
}

/** Append-only audit record. Fire-and-forget from callers: never fails the request. */
export async function logAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(schema.auditLogs).values({
    actor_id: entry.actorId ?? null,
    actor_ip: entry.actorIp ?? null,
    action: entry.action,
    target_type: entry.targetType ?? null,
    target_id: entry.targetId ?? null,
    meta: entry.meta ?? {},
  });
}

/** Recent audit rows — admin dashboard view. */
export async function listRecentAudit(
  db: Db,
  options: { limit?: number; offset?: number } = {},
): Promise<Array<typeof schema.auditLogs.$inferSelect>> {
  const limit = Math.min(options.limit ?? 50, 200);
  return db
    .select()
    .from(schema.auditLogs)
    .orderBy(desc(schema.auditLogs.created_at))
    .limit(limit)
    .offset(options.offset ?? 0);
}

/** 审计日志条目 + 操作者信息（列表页直接可读，不必再查用户表）。 */
export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  actorDisplayName: string | null;
  actorIp: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown>;
  createdAt: Date;
}

export interface AuditLogQuery {
  /** 只看某个前缀的动作，例如 `admin.`；空/缺省 = 全部。 */
  actionPrefix?: string;
  limit?: number;
  offset?: number;
}

/**
 * 「管理员干了啥」的完整流水：按时间倒序，带上操作者用户名。
 *
 * 审计表只增不改，这里只读；`meta` 的结构化细节原样返回。
 */
export async function listAuditLogs(
  db: Db,
  options: AuditLogQuery = {},
): Promise<{ entries: AuditLogEntry[]; total: number }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const prefix = options.actionPrefix?.trim();
  const where = prefix ? like(schema.auditLogs.action, `${prefix}%`) : undefined;

  const rows = await db
    .select({
      id: schema.auditLogs.id,
      actorId: schema.auditLogs.actor_id,
      actorUsername: schema.users.username,
      actorDisplayName: schema.users.display_name,
      actorIp: schema.auditLogs.actor_ip,
      action: schema.auditLogs.action,
      targetType: schema.auditLogs.target_type,
      targetId: schema.auditLogs.target_id,
      meta: schema.auditLogs.meta,
      createdAt: schema.auditLogs.created_at,
    })
    .from(schema.auditLogs)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actor_id))
    .where(where)
    .orderBy(desc(schema.auditLogs.created_at))
    .limit(limit)
    .offset(offset);

  const totals = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.auditLogs)
    .where(where);

  return {
    entries: rows.map((row) => ({ ...row, meta: (row.meta ?? {}) as Record<string, unknown> })),
    total: totals[0]?.n ?? 0,
  };
}