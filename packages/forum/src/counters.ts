import { eq } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { computeLevel } from '@ycomm/config';

/** Current post count — drives the new-member review gate. */
export async function getPostCount(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select({ post_count: schema.users.post_count })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return rows[0]?.post_count ?? 0;
}

interface StatsDelta {
  posts?: number;
  likesReceived?: number;
}

/**
 * Apply counter deltas and recompute the derived level in one step.
 *
 * Levels are pure functions of (post_count, like_received_count,
 * account age) — this is the only write path for those counters, so they and
 * the level can never drift apart.
 */
export async function bumpUserStats(db: Db, userId: string, delta: StatsDelta = {}): Promise<void> {
  const rows = await db
    .select({
      post_count: schema.users.post_count,
      like_received_count: schema.users.like_received_count,
      created_at: schema.users.created_at,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return;

  const postCount = Math.max(0, row.post_count + (delta.posts ?? 0));
  const likeReceivedCount = Math.max(0, row.like_received_count + (delta.likesReceived ?? 0));
  const accountAgeDays = Math.max(0, Math.floor((Date.now() - row.created_at.getTime()) / 86_400_000));
  const level = computeLevel({ postCount, likeReceivedCount, accountAgeDays });

  await db
    .update(schema.users)
    .set({
      post_count: postCount,
      like_received_count: likeReceivedCount,
      level,
      level_updated_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(schema.users.id, userId));
}