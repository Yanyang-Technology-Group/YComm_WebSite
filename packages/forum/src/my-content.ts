import { desc, eq } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';

/** 当前用户的主题列表（个人控制台「我的主题」）。 */
export async function listTopicsByAuthor(db: Db, authorId: string) {
  return db
    .select({
      id: schema.topics.id,
      title: schema.topics.title,
      reply_count: schema.topics.reply_count,
      view_count: schema.topics.view_count,
      created_at: schema.topics.created_at,
      board_slug: schema.boards.slug,
    })
    .from(schema.topics)
    .innerJoin(schema.boards, eq(schema.topics.board_id, schema.boards.id))
    .where(eq(schema.topics.author_id, authorId))
    .orderBy(desc(schema.topics.created_at))
    .limit(50);
}

/** 当前用户的回帖列表（个人控制台「我的回帖」）。 */
export async function listPostsByAuthor(db: Db, authorId: string) {
  return db
    .select({
      id: schema.posts.id,
      content_md: schema.posts.content_md,
      created_at: schema.posts.created_at,
      topic_id: schema.topics.id,
      topic_title: schema.topics.title,
      board_slug: schema.boards.slug,
    })
    .from(schema.posts)
    .innerJoin(schema.topics, eq(schema.posts.topic_id, schema.topics.id))
    .innerJoin(schema.boards, eq(schema.topics.board_id, schema.boards.id))
    .where(eq(schema.posts.author_id, authorId))
    .orderBy(desc(schema.posts.created_at))
    .limit(50);
}
