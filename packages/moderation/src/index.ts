import { and, desc, eq } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { errors } from '@ycomm/kernel';

/**
 * The unified review queue.
 *
 * New-member posts, user reports, admin-uploaded resources and flagged links
 * all land here, and the dashboard renders ONE "things to decide" list. The
 * domain that owns the target registers a `Decider` (approve/reject callbacks)
 * so this package never needs to know how to publish a topic or a resource.
 */

export type ModerationReason =
  | 'new_user_review'
  | 'reported'
  | 'manual'
  | 'admin_upload_review'
  | 'dead_link_review';

export interface EnqueueInput {
  targetType: string;
  targetId: string;
  reason: ModerationReason;
  reporterId?: string | null;
  detail?: string | null;
}

export async function enqueueForReview(db: Db, input: EnqueueInput): Promise<void> {
  await db.insert(schema.moderationItems).values({
    target_type: input.targetType,
    target_id: input.targetId,
    reason: input.reason,
    reporter_id: input.reporterId ?? null,
    detail: input.detail ?? null,
  });
}

export interface DeciderContext {
  db: Db;
  targetType: string;
  targetId: string;
}

export interface Decider {
  approve(context: DeciderContext): Promise<void>;
  reject(context: DeciderContext): Promise<void>;
}

const DECIDERS = new Map<string, Decider>();

/** Register the approve/reject behavior for a target type (forum, downloads). */
export function registerDecider(targetType: string, decider: Decider): void {
  DECIDERS.set(targetType, decider);
}

export async function listQueued(
  db: Db,
  options: { offset?: number; limit?: number } = {},
): Promise<Array<typeof schema.moderationItems.$inferSelect>> {
  return db
    .select()
    .from(schema.moderationItems)
    .where(eq(schema.moderationItems.status, 'pending'))
    .orderBy(desc(schema.moderationItems.created_at))
    .limit(Math.min(options.limit ?? 50, 100))
    .offset(options.offset ?? 0);
}

export type ModerationDecision = 'approve' | 'reject';

/**
 * Decide one queue item: runs the domain decider inside a transaction, then
 * records the decision and its author.
 */
export async function decide(
  db: Db,
  itemId: string,
  input: { decision: ModerationDecision; by: string; note?: string | null },
): Promise<void> {
  const items = await db
    .select()
    .from(schema.moderationItems)
    .where(and(eq(schema.moderationItems.id, itemId), eq(schema.moderationItems.status, 'pending')))
    .limit(1);
  const item = items[0];
  if (!item) {
    throw errors.notFound('待处理项不存在或已被处理');
  }

  const decider = DECIDERS.get(item.target_type);
  if (!decider) {
    throw errors.internal(undefined, `no moderation decider registered for ${item.target_type}`);
  }

  const context: DeciderContext = { db, targetType: item.target_type, targetId: item.target_id };

  await db.transaction(async (tx) => {
    const txContext: DeciderContext = { ...context, db: tx as unknown as Db };
    if (input.decision === 'approve') {
      await decider.approve(txContext);
    } else {
      await decider.reject(txContext);
    }
    await tx
      .update(schema.moderationItems)
      .set({
        status: input.decision === 'approve' ? 'approved' : 'rejected',
        decided_by: input.by,
        decided_at: new Date(),
        decision_note: input.note ?? null,
      })
      .where(eq(schema.moderationItems.id, item.id));
  });
}