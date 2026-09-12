import { eq } from 'drizzle-orm';
import { schema } from '@ycomm/db';
import { registerDecider } from '@ycomm/moderation';

/**
 * Deciders making the unified moderation queue able to act on download
 * resources and links: approving a resource publishes it, rejecting returns
 * it to the author with a note; approving a dead-link report marks it dead.
 */
export function registerDownloadDeciders(): void {
  registerDecider('download_resource', {
    approve: async ({ db, targetId }) => {
      await db
        .update(schema.downloadResources)
        .set({ status: 'published', published_at: new Date(), updated_at: new Date() })
        .where(eq(schema.downloadResources.id, targetId));
    },
    reject: async ({ db, targetId }) => {
      await db
        .update(schema.downloadResources)
        .set({ status: 'rejected', review_note: '审核未通过', updated_at: new Date() })
        .where(eq(schema.downloadResources.id, targetId));
    },
  });

  registerDecider('download_link', {
    approve: async ({ db, targetId }) => {
      await db.update(schema.downloadLinks).set({ status: 'dead' }).where(eq(schema.downloadLinks.id, targetId));
    },
    reject: async ({ db, targetId }) => {
      await db.update(schema.downloadLinks).set({ status: 'active', reported_dead_count: 0 }).where(eq(schema.downloadLinks.id, targetId));
    },
  });
}