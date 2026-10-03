import { and, eq } from 'drizzle-orm';
import { schema } from '@ycomm/db';
import { registerDecider } from '@ycomm/moderation';
import { registerJobHandler } from '@ycomm/jobs';
import { enqueue } from '@ycomm/jobs';

/**
 * Deciders that make the unified moderation queue actually able to act on
 * forum content: approving a pending topic/post publishes it, rejecting deletes
 * it. Register once at application boot.
 */
export function registerForumDeciders(): void {
  registerJobHandler('forum.publish_scheduled_topic', async (payload, { db }) => {
    const topicId = payload.topicId;
    if (typeof topicId !== 'string') throw new Error('scheduled topic job missing topicId');
    await db.transaction(async (tx) => {
      // 只发布仍处于 scheduled 的主题：期间被删除/隐藏/提前批准的主题不会被这条
      // 定时任务复活；重复入队的任务也在这里自然去重。
      const rows = await tx.update(schema.topics)
        .set({ status: 'published', scheduled_at: null, updated_at: new Date() })
        .where(and(eq(schema.topics.id, topicId), eq(schema.topics.status, 'scheduled')))
        .returning({ id: schema.topics.id });
      if (rows.length > 0) {
        await tx.update(schema.posts)
          .set({ status: 'published' })
          .where(and(eq(schema.posts.topic_id, topicId), eq(schema.posts.status, 'scheduled')));
      }
    });
  });
  registerDecider('topic', {
    approve: async ({ db, targetId }) => {
      const rows = await db.select({ scheduled_at: schema.topics.scheduled_at }).from(schema.topics).where(eq(schema.topics.id, targetId)).limit(1);
      const scheduledAt = rows[0]?.scheduled_at;
      await db.update(schema.topics).set({
        status: scheduledAt && scheduledAt > new Date() ? 'scheduled' : 'published',
        scheduled_at: scheduledAt && scheduledAt > new Date() ? scheduledAt : null,
        updated_at: new Date(),
      }).where(eq(schema.topics.id, targetId));
      await db.update(schema.posts).set({
        status: scheduledAt && scheduledAt > new Date() ? 'scheduled' : 'published',
      }).where(eq(schema.posts.topic_id, targetId));
      if (scheduledAt && scheduledAt > new Date()) {
        await enqueue(db, 'forum.publish_scheduled_topic', { runAt: scheduledAt, payload: { topicId: targetId } });
      }
    },
    reject: async ({ db, targetId }) => {
      await db.update(schema.topics).set({ status: 'deleted', deleted_at: new Date(), updated_at: new Date() }).where(eq(schema.topics.id, targetId));
    },
  });

  registerDecider('post', {
    approve: async ({ db, targetId }) => {
      await db.update(schema.posts).set({ status: 'published' }).where(eq(schema.posts.id, targetId));
    },
    reject: async ({ db, targetId }) => {
      await db.update(schema.posts).set({ status: 'deleted', deleted_at: new Date() }).where(eq(schema.posts.id, targetId));
    },
  });
}
