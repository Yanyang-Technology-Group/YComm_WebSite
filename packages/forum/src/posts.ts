import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import { MODERATION } from '@ycomm/config';
import { enqueueForReview } from '@ycomm/moderation';
import { assertNoBannedWords, loadBannedWords } from './banned-words';
import { bumpUserStats } from './counters';

export type PostRow = typeof schema.posts.$inferSelect;

export interface PostWithAuthor extends PostRow {
  authorUsername: string | null;
  authorDisplayName: string | null;
}

export interface CreatePostInput {
  topicId: string;
  /** NULL for guest posts in public boards. */
  authorId: string | null;
  authorPostCount: number;
  authorRole: 'member' | 'admin' | 'owner' | 'guest';
  contentMd: string;
  replyToPostId?: string | null;
}

export async function createPost(db: Db, input: CreatePostInput): Promise<PostRow> {
  const contentMd = input.contentMd.trim();
  if (contentMd.length < 1 || contentMd.length > 100_000) {
    throw errors.validation({ issues: [{ path: 'content', message: '内容不能为空且不超过 10000 字' }] });
  }

  const banned = await loadBannedWords(db);
  assertNoBannedWords(contentMd, banned);

  const needsReview =
    input.authorId !== null && input.authorRole === 'member' && input.authorPostCount < MODERATION.newMemberReviewPostCount;

  const post = await db.transaction(async (tx) => {
    const topicRows = await tx
      .select({ id: schema.topics.id, is_locked: schema.topics.is_locked, status: schema.topics.status })
      .from(schema.topics)
      .where(eq(schema.topics.id, input.topicId))
      .limit(1);
    const topic = topicRows[0];
    if (!topic) throw errors.notFound('主题不存在');
    if (topic.is_locked) throw errors.forbidden('主题已锁定，无法回复');
    if (topic.status !== 'published') throw errors.forbidden('主题当前不可回复');

    const [maxRow] = await tx
      .select({ max: sql<number>`coalesce(max(${schema.posts.position}), 0)` })
      .from(schema.posts)
      .where(eq(schema.posts.topic_id, input.topicId));
    const position = (maxRow?.max ?? 0) + 1;

    const [created] = await tx
      .insert(schema.posts)
      .values({
        topic_id: input.topicId,
        author_id: input.authorId,
        position,
        content_md: contentMd,
        status: needsReview ? 'pending' : 'published',
        reply_to_post_id: input.replyToPostId ?? null,
      })
      .returning();
    if (!created) throw errors.internal(undefined, 'post insert failed');

    await tx
      .update(schema.topics)
      .set({
        reply_count: sql`${schema.topics.reply_count} + 1`,
        last_post_at: new Date(),
        last_post_author_id: input.authorId,
        updated_at: new Date(),
      })
      .where(eq(schema.topics.id, input.topicId));

    if (needsReview) {
      await enqueueForReview(tx as unknown as Db, {
        targetType: 'post',
        targetId: created.id,
        reason: 'new_user_review',
      });
    }

    return created;
  });

  if (input.authorId) {
    await bumpUserStats(db, input.authorId, { posts: 1 });
  }
  return post;
}

export async function getPostById(db: Db, postId: string): Promise<PostRow | null> {
  const rows = await db.select().from(schema.posts).where(eq(schema.posts.id, postId)).limit(1);
  return rows[0] ?? null;
}

export async function listPosts(
  db: Db,
  topicId: string,
  options: { offset?: number; limit?: number } = {},
): Promise<{ posts: PostWithAuthor[]; total: number }> {
  const limit = Math.min(options.limit ?? 50, 200);
  const where = and(eq(schema.posts.topic_id, topicId), eq(schema.posts.status, 'published'));

  const posts = await db
    .select({
      id: schema.posts.id,
      topic_id: schema.posts.topic_id,
      author_id: schema.posts.author_id,
      position: schema.posts.position,
      content_md: schema.posts.content_md,
      status: schema.posts.status,
      reply_to_post_id: schema.posts.reply_to_post_id,
      edited_at: schema.posts.edited_at,
      edit_count: schema.posts.edit_count,
      created_at: schema.posts.created_at,
      deleted_at: schema.posts.deleted_at,
      deleted_by: schema.posts.deleted_by,
      authorUsername: schema.users.username,
      authorDisplayName: schema.users.display_name,
    })
    .from(schema.posts)
    .leftJoin(schema.users, eq(schema.posts.author_id, schema.users.id))
    .where(where)
    .orderBy(asc(schema.posts.position))
    .limit(limit)
    .offset(options.offset ?? 0);

  const totals = await db.select({ n: sql<number>`count(*)::int` }).from(schema.posts).where(where);
  return { posts, total: totals[0]?.n ?? 0 };
}

/**
 * Edit a post the author owns, within the self-edit window, keeping revisions.
 */
export async function editPost(
  db: Db,
  postId: string,
  editorId: string,
  contentMd: string,
): Promise<PostRow> {
  const cleaned = contentMd.trim();
  if (cleaned.length < 1) {
    throw errors.validation({ issues: [{ path: 'content', message: '内容不能为空' }] });
  }

  const rows = await db.select().from(schema.posts).where(eq(schema.posts.id, postId)).limit(1);
  const post = rows[0];
  if (!post) throw errors.notFound('帖子不存在');
  if (post.author_id === null) {
    throw errors.forbidden('访客内容不可编辑');
  }
  if (post.author_id !== editorId) {
    throw errors.forbidden('只能编辑自己的帖子');
  }
  const editWindowMs = MODERATION.selfEditWindowMinutes * 60 * 1000;
  if (Date.now() - post.created_at.getTime() > editWindowMs) {
    throw errors.forbidden('已过可编辑时间');
  }

  return db.transaction(async (tx) => {
    await tx.insert(schema.postRevisions).values({
      post_id: postId,
      content_md: post.content_md,
      edited_by: editorId,
    });
    const [updated] = await tx
      .update(schema.posts)
      .set({
        content_md: cleaned,
        edited_at: new Date(),
        edit_count: sql`${schema.posts.edit_count} + 1`,
      })
      .where(eq(schema.posts.id, postId))
      .returning();
    if (!updated) throw errors.internal(undefined, 'post update failed');
    return updated;
  });
}

/** Soft-delete a post (own or staff). Counts are not decremented to keep history true. */
export async function deletePost(db: Db, postId: string, byId: string): Promise<void> {
  await db
    .update(schema.posts)
    .set({ status: 'deleted', deleted_at: new Date(), deleted_by: byId })
    .where(eq(schema.posts.id, postId));
}

export async function likePost(db: Db, postId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const posts = await tx.select().from(schema.posts).where(eq(schema.posts.id, postId)).limit(1);
    const post = posts[0];
    if (!post) throw errors.notFound('帖子不存在');

    const inserted = await tx
      .insert(schema.reactions)
      .values({ user_id: userId, target_type: 'post', target_id: postId })
      .onConflictDoNothing()
      .returning({ id: schema.reactions.id });

    if (inserted.length > 0 && post.author_id) {
      await tx
        .update(schema.users)
        .set({ like_received_count: sql`${schema.users.like_received_count} + 1` })
        .where(eq(schema.users.id, post.author_id));
    }
  });
  await bumpUserStatsFromLikes(db, postId);
}

export async function unlikePost(db: Db, postId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const posts = await tx.select().from(schema.posts).where(eq(schema.posts.id, postId)).limit(1);
    const post = posts[0];
    if (!post) throw errors.notFound('帖子不存在');

    const deleted = await tx
      .delete(schema.reactions)
      .where(
        and(
          eq(schema.reactions.user_id, userId),
          eq(schema.reactions.target_type, 'post'),
          eq(schema.reactions.target_id, postId),
        ),
      )
      .returning({ id: schema.reactions.id });
    if (deleted.length > 0 && post.author_id) {
      await tx
        .update(schema.users)
        .set({ like_received_count: sql`greatest(${schema.users.like_received_count} - 1, 0)` })
        .where(eq(schema.users.id, post.author_id));
    }
  });
  await bumpUserStatsFromLikes(db, postId);
}

/** Recompute the target author's level from the fresh counters. */
async function bumpUserStatsFromLikes(db: Db, postId: string): Promise<void> {
  const rows = await db.select({ author_id: schema.posts.author_id }).from(schema.posts).where(eq(schema.posts.id, postId)).limit(1);
  const authorId = rows[0]?.author_id;
  if (!authorId) return;
  await bumpUserStats(db, authorId, { likesReceived: 0 });
}

export async function hasLiked(db: Db, postId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.reactions.id })
    .from(schema.reactions)
    .where(
      and(
        eq(schema.reactions.user_id, userId),
        eq(schema.reactions.target_type, 'post'),
        eq(schema.reactions.target_id, postId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function listPostRevisions(db: Db, postId: string): Promise<Array<typeof schema.postRevisions.$inferSelect>> {
  return db
    .select()
    .from(schema.postRevisions)
    .where(eq(schema.postRevisions.post_id, postId))
    .orderBy(desc(schema.postRevisions.created_at))
    .limit(10);
}