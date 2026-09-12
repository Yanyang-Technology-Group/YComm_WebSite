import { eq } from 'drizzle-orm';
import { schema } from '@ycomm/db';
import { registerDecider } from '@ycomm/moderation';

/**
 * Deciders that make the unified moderation queue actually able to act on
 * forum content: approving a pending topic/post publishes it, rejecting deletes
 * it. Register once at application boot.
 */
export function registerForumDeciders(): void {
  registerDecider('topic', {
    approve: async ({ db, targetId }) => {
      await db.update(schema.topics).set({ status: 'published', updated_at: new Date() }).where(eq(schema.topics.id, targetId));
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