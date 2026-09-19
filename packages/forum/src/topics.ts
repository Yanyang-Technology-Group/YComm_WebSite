import { and, desc, eq, exists, ilike, isNull, or, sql } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import { MODERATION } from '@ycomm/config';
import { enqueueForReview } from '@ycomm/moderation';
import { newTopicSlug } from './slug';
import { bumpUserStats } from './counters';
import { assertNoBannedWords, loadBannedWords } from './banned-words';

export type TopicRow = typeof schema.topics.$inferSelect;
export type PostRow = typeof schema.posts.$inferSelect;

export interface TopicWithAuthor extends TopicRow {
  authorUsername: string | null;
  authorDisplayName: string | null;
  authorLevel: number | null;
}

export interface CreateTopicInput {
  boardId: string;
  /** NULL for guest posts in public boards. */
  authorId: string | null;
  /** Author's post count BEFORE this post; drives the new-member review gate. */
  authorPostCount: number;
  /** Review gate applies to members only — staff and guests publish directly. */
  authorRole: 'member' | 'admin' | 'owner' | 'guest';
  title: string;
  contentMd: string;
}

export interface CreateTopicResult {
  topic: TopicRow;
  post: PostRow;
  needsReview: boolean;
}

export async function createTopic(db: Db, input: CreateTopicInput): Promise<CreateTopicResult> {
  const title = input.title.trim();
  const contentMd = input.contentMd.trim();
  if (title.length < 2 || title.length > 120) {
    throw errors.validation({ issues: [{ path: 'title', message: '标题长度为 2-120' }] });
  }
  if (contentMd.length < 1 || contentMd.length > 100_000) {
    throw errors.validation({ issues: [{ path: 'content', message: '内容不能为空且不超过 10000 字' }] });
  }

  const banned = await loadBannedWords(db);
  assertNoBannedWords(`${title}\n${contentMd}`, banned);

  const needsReview =
    input.authorId !== null && input.authorRole === 'member' && input.authorPostCount < MODERATION.newMemberReviewPostCount;

  const result = await db.transaction(async (tx) => {
    const [topic] = await tx
      .insert(schema.topics)
      .values({
        board_id: input.boardId,
        author_id: input.authorId,
        title,
        slug: newTopicSlug(),
        status: needsReview ? 'pending' : 'published',
      })
      .returning();
    if (!topic) throw errors.internal(undefined, 'topic insert failed');

    const [post] = await tx
      .insert(schema.posts)
      .values({
        topic_id: topic.id,
        author_id: input.authorId,
        position: 1,
        content_md: contentMd,
        status: needsReview ? 'pending' : 'published',
      })
      .returning();
    if (!post) throw errors.internal(undefined, 'post insert failed');

    await tx
      .update(schema.boards)
      .set({
        topic_count: sql`${schema.boards.topic_count} + 1`,
        post_count: sql`${schema.boards.post_count} + 1`,
        updated_at: new Date(),
      })
      .where(eq(schema.boards.id, input.boardId));

    if (needsReview) {
      await enqueueForReview(tx as unknown as Db, {
        targetType: 'topic',
        targetId: topic.id,
        reason: 'new_user_review',
      });
    }

    return { topic, post };
  });

  if (input.authorId) {
    await bumpUserStats(db, input.authorId, { posts: 1 });
  }
  return { ...result, needsReview };
}

export async function getTopicById(db: Db, topicId: string): Promise<TopicRow | null> {
  const rows = await db.select().from(schema.topics).where(eq(schema.topics.id, topicId)).limit(1);
  return rows[0] ?? null;
}

const TOPIC_WITH_AUTHOR_COLUMNS = {
  id: schema.topics.id,
  board_id: schema.topics.board_id,
  author_id: schema.topics.author_id,
  title: schema.topics.title,
  slug: schema.topics.slug,
  is_pinned: schema.topics.is_pinned,
  is_locked: schema.topics.is_locked,
  status: schema.topics.status,
  reply_count: schema.topics.reply_count,
  view_count: schema.topics.view_count,
  last_post_at: schema.topics.last_post_at,
  last_post_author_id: schema.topics.last_post_author_id,
  created_at: schema.topics.created_at,
  updated_at: schema.topics.updated_at,
  deleted_at: schema.topics.deleted_at,
  deleted_by: schema.topics.deleted_by,
  authorUsername: schema.users.username,
  authorDisplayName: schema.users.display_name,
  authorLevel: schema.users.level,
};

const publishedAndNotDeleted = (boardId?: string) =>
  and(eq(schema.topics.status, 'published'), isNull(schema.topics.deleted_at), ...(boardId ? [eq(schema.topics.board_id, boardId)] : []));

export interface TopicListOptions {
  boardId?: string;
  offset?: number;
  limit?: number;
}

export async function listTopics(
  db: Db,
  options: TopicListOptions = {},
): Promise<{ topics: TopicWithAuthor[]; total: number }> {
  const limit = Math.min(options.limit ?? 20, 100);
  const where = publishedAndNotDeleted(options.boardId);

  const topics = await db
    .select(TOPIC_WITH_AUTHOR_COLUMNS)
    .from(schema.topics)
    .leftJoin(schema.users, eq(schema.topics.author_id, schema.users.id))
    .where(where)
    // 置顶（管理员手动置顶，行首有 📌）永远在最上面；其余按「发表时间」倒序 —— 越新越靠上，
    // 与列表里显示的发表时间一致（之前按最后回复时间排，界面上看着就乱了）。
    .orderBy(desc(schema.topics.is_pinned), desc(schema.topics.created_at))
    .limit(limit)
    .offset(options.offset ?? 0);

  const totals = await db.select({ n: sql<number>`count(*)::int` }).from(schema.topics).where(where);
  return { topics, total: totals[0]?.n ?? 0 };
}

export async function incrementViewCount(db: Db, topicId: string): Promise<void> {
  await db
    .update(schema.topics)
    .set({ view_count: sql`${schema.topics.view_count} + 1` })
    .where(eq(schema.topics.id, topicId));
}

export type TopicModerationAction = 'pin' | 'unpin' | 'lock' | 'unlock' | 'delete' | 'move';

export async function moderateTopic(
  db: Db,
  topicId: string,
  action: TopicModerationAction,
  options: { newBoardId?: string; byId?: string } = {},
): Promise<TopicRow> {
  const patch: Record<string, unknown> = {};
  if (action === 'pin') patch.is_pinned = true;
  if (action === 'unpin') patch.is_pinned = false;
  if (action === 'lock') patch.is_locked = true;
  if (action === 'unlock') patch.is_locked = false;
  if (action === 'delete') {
    patch.status = 'deleted';
    patch.deleted_at = new Date();
    patch.deleted_by = options.byId ?? null;
  }
  if (action === 'move') {
    if (!options.newBoardId) {
      throw errors.validation({ issues: [{ path: 'boardId', message: '缺少目标版块' }] });
    }
    patch.board_id = options.newBoardId;
  }

  const [updated] = await db
    .update(schema.topics)
    .set({ ...patch, updated_at: new Date() })
    .where(eq(schema.topics.id, topicId))
    .returning();
  if (!updated) throw errors.notFound('主题不存在');

  // 删除后同步修正统计：主题下的帖子一并标记删除，版块与作者的计数器回退，
  // 这样「社区统计」「我的内容」不会再显示已删除的内容。
  if (action === 'delete') {
    const removedPosts = 1 + (updated.reply_count ?? 0);
    await db
      .update(schema.posts)
      .set({ status: 'deleted', deleted_at: new Date(), deleted_by: options.byId ?? null })
      .where(eq(schema.posts.topic_id, topicId));
    await db
      .update(schema.boards)
      .set({
        topic_count: sql`greatest(${schema.boards.topic_count} - 1, 0)`,
        post_count: sql`greatest(${schema.boards.post_count} - ${removedPosts}, 0)`,
        updated_at: new Date(),
      })
      .where(eq(schema.boards.id, updated.board_id));
    if (updated.author_id) {
      await bumpUserStats(db, updated.author_id, { posts: -removedPosts });
    }
  }

  return updated;
}

export interface SearchOptions {
  offset?: number;
  limit?: number;
}

/** Simple ILIKE search across titles and opening posts. Upgrade path: pg_trgm/Meilisearch. */
export async function searchTopics(
  db: Db,
  query: string,
  options: SearchOptions = {},
): Promise<TopicWithAuthor[]> {
  const q = query.trim();
  if (!q) return [];
  const likeQuery = `%${q}%`;
  const limit = Math.min(options.limit ?? 20, 100);

  return db
    .select(TOPIC_WITH_AUTHOR_COLUMNS)
    .from(schema.topics)
    .leftJoin(schema.users, eq(schema.topics.author_id, schema.users.id))
    .where(
      and(
        eq(schema.topics.status, 'published'),
        isNull(schema.topics.deleted_at),
        or(
          ilike(schema.topics.title, likeQuery),
          exists(
            db
              .select({ one: sql`1` })
              .from(schema.posts)
              .where(
                and(
                  eq(schema.posts.topic_id, schema.topics.id),
                  eq(schema.posts.position, 1),
                  ilike(schema.posts.content_md, likeQuery),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(desc(schema.topics.last_post_at))
    .limit(limit)
    .offset(options.offset ?? 0);
}