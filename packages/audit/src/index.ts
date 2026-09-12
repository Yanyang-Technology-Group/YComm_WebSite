import { desc } from 'drizzle-orm';
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