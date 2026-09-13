import { desc, eq } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';

/** 当前用户上传的资源列表（个人控制台「我的资源」）。 */
export async function listResourcesByAuthor(db: Db, authorId: string) {
  return db
    .select({
      id: schema.downloadResources.id,
      title: schema.downloadResources.title,
      status: schema.downloadResources.status,
      source_type: schema.downloadResources.source_type,
      version_label: schema.downloadResources.version_label,
      download_count: schema.downloadResources.download_count,
      created_at: schema.downloadResources.created_at,
    })
    .from(schema.downloadResources)
    .where(eq(schema.downloadResources.author_id, authorId))
    .orderBy(desc(schema.downloadResources.created_at))
    .limit(50);
}
