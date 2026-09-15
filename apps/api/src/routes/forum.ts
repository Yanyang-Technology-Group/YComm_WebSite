import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import { getDb, schema, type Db } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import { PERMISSION } from '@ycomm/config';
import { assertCanViewResource, assertPermission, assertSubjectCanAct } from '@ycomm/access';
import {
  assertCanPostInBoard,
  createPost,
  createTopic,
  deletePost,
  editPost,
  getBoardById,
  getBoardBySlug,
  getPostById,
  getPostCount,
  getTopicById,
  hasLiked,
  incrementViewCount,
  likePost,
  listBoards,
  listPosts,
  listTopics,
  listTopicPreviews,
  moderateTopic,
  searchTopics,
  unlikePost,
} from '@ycomm/forum';
import { decide, listQueued } from '@ycomm/moderation';
import { logAudit } from '@ycomm/audit';
import { createNotification, hasRecentNotification, type NotificationActor } from '@ycomm/notify';
import { listBadgesForUsers, searchUsers } from '@ycomm/identity';
import { searchCards } from '@ycomm/downloads';
import type { AppVariables } from '../context';
import { clientIp, requireAuth, sessionAuth } from '../middleware/session';
import { requirePermission } from '../middleware/permission';
import { rateLimitByUser } from '../middleware/rate-limit';

export async function parseBody<T>(c: Context, bodySchema: z.ZodType<T>): Promise<T> {
  const body = await c.req.json().catch(() => ({}));
  const result = bodySchema.safeParse(body);
  if (!result.success) {
    throw errors.validation({
      issues: result.error.issues.map((issue) => ({ path: issue.path.join('.') || '(root)', message: issue.message })),
    });
  }
  return result.data;
}

/** 通知触发者快照（注销后也能显示名字）。 */
async function actorOf(db: Db, userId: string | null | undefined): Promise<NotificationActor | null> {
  if (!userId) return null;
  const rows = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      display_name: schema.users.display_name,
      avatar_path: schema.users.avatar_path,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const user = rows[0];
  if (!user) return null;
  return { id: user.id, username: user.username, displayName: user.display_name, avatarPath: user.avatar_path };
}

/** 主题通知的目标链接（客户端路由格式 /forum/<boardSlug>/<topicId>）。 */
async function topicLink(db: Db, topicId: string): Promise<string | null> {
  const topic = await getTopicById(db, topicId);
  if (!topic) return null;
  const board = await getBoardById(db, topic.board_id);
  return board ? `/forum/${board.slug}/${topicId}` : `/forum`;
}

/** 相关度：前缀命中 2 分，包含命中 1 分，否则 0。 */
function rankOf(text: string, lower: string): number {
  const t = text.toLowerCase();
  if (t.startsWith(lower)) return 2;
  if (t.includes(lower)) return 1;
  return 0;
}

const createTopicSchema = z.object({
  title: z.string().min(1).max(120),
  content: z.string().min(1).max(100_000),
});

const createPostSchema = z.object({
  content: z.string().min(1).max(100_000),
  replyToPostId: z.string().optional(),
});

const topicActionSchema = z.object({
  action: z.enum(['pin', 'unpin', 'lock', 'unlock', 'delete', 'move']),
  boardId: z.string().optional(),
});

const decideSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(500).optional(),
});

export function forumRoutes(): Hono<{ Variables: AppVariables }> {
  const router = new Hono<{ Variables: AppVariables }>();
  router.use('*', sessionAuth);

  // ---- boards ----------------------------------------------------------
  router.get('/boards', async (c) => {
    const handle = await getDb();
    const boards = await listBoards(handle.db, c.get('auth')?.subject ?? null);
    return c.json({ ok: true, data: { boards } });
  });

  // ---- topic list ------------------------------------------------------
  router.get('/boards/:slug/topics', async (c) => {
    const handle = await getDb();
    const subject = c.get('auth')?.subject ?? null;
    const board = await getBoardBySlug(handle.db, c.req.param('slug'));
    if (!board) throw errors.notFound('版块不存在');
    await assertCanViewResource(handle.db, subject, { type: 'board', id: board.id, policy: board.policy });

    const offset = Number.parseInt(c.req.query('offset') ?? '0', 10) || 0;
    const limit = Math.min(Number.parseInt(c.req.query('limit') ?? '20', 10) || 20, 100);
    const result = await listTopics(handle.db, { boardId: board.id, offset, limit });
    const previews = await listTopicPreviews(
      handle.db,
      result.topics.map((topic) => topic.id),
    );
    return c.json({
      ok: true,
      data: {
        total: result.total,
        topics: result.topics.map((topic) => ({
          ...topic,
          preview: previews.get(topic.id) ?? { firstPost: null, topReplies: [] },
        })),
      },
    });
  });

  // ---- create topic ----------------------------------------------------
  router.post('/boards/:slug/topics', rateLimitByUser('topicCreate'), async (c) => {
    const body = await parseBody(c, createTopicSchema);
    const handle = await getDb();
    const auth = c.get('auth');

    const board = await getBoardBySlug(handle.db, c.req.param('slug'));
    if (!board) throw errors.notFound('版块不存在');

    let authorId: string | null = null;
    let authorRole: 'member' | 'admin' | 'owner' | 'guest' = 'guest';
    let authorPostCount = 0;

    if (auth) {
      assertSubjectCanAct(auth.subject);
      assertPermission(auth.subject, PERMISSION.FORUM_TOPIC_CREATE);
      authorId = auth.userId;
      authorRole = auth.subject.role;
      authorPostCount = await getPostCount(handle.db, auth.userId);
    } else if (board.policy.visibility !== 'public') {
      // 未登录只能进入/发布于公开板块 —— 其余内容一律登录墙。
      throw errors.loginRequired();
    }
    await assertCanViewResource(handle.db, auth?.subject ?? null, {
      type: 'board',
      id: board.id,
      policy: board.policy,
    });
    // 发帖权限：仅管理员/站长的版块，普通用户与游客不能发主题。
    assertCanPostInBoard(auth?.subject ?? null, board);

    const result = await createTopic(handle.db, {
      boardId: board.id,
      authorId,
      authorPostCount,
      authorRole,
      title: body.title,
      contentMd: body.content,
    });

    return c.json({ ok: true, data: result }, 201);
  });

  // ---- topic detail ----------------------------------------------------
  router.get('/topics/:topicId', async (c) => {
    const handle = await getDb();
    const subject = c.get('auth')?.subject ?? null;
    const topic = await getTopicById(handle.db, c.req.param('topicId'));
    if (!topic || topic.status !== 'published') throw errors.notFound('主题不存在');

    const board = await getBoardById(handle.db, topic.board_id);
    if (!board) throw errors.notFound('主题不存在');
    await assertCanViewResource(handle.db, subject, { type: 'board', id: board.id, policy: board.policy });

    await incrementViewCount(handle.db, topic.id);
    const { posts } = await listPosts(handle.db, topic.id, {
      offset: Number.parseInt(c.req.query('offset') ?? '0', 10) || 0,
    });

    const likedPostIds: string[] = [];
    const auth = c.get('auth');
    if (auth) {
      for (const post of posts) {
        if (await hasLiked(handle.db, post.id, auth.userId)) likedPostIds.push(post.id);
      }
      // 浏览通知：自己看自己的主题不发；同一浏览者 24 小时只提醒一次（避免刷屏）。
      if (topic.author_id && topic.author_id !== auth.userId) {
        const already = await hasRecentNotification(handle.db, {
          userId: topic.author_id,
          kind: 'view',
          topicId: topic.id,
          actorId: auth.userId,
        });
        if (!already) {
          const actor = await actorOf(handle.db, auth.userId);
          await createNotification(handle.db, {
            userId: topic.author_id,
            kind: 'view',
            title: `你的主题「${topic.title}」被浏览了`,
            linkUrl: await topicLink(handle.db, topic.id),
            actor,
            topicId: topic.id,
          });
        }
      }
    }

    // 每个帖子的作者带上徽章（前台在作者名旁展示）。
    const badges = await listBadgesForUsers(
      handle.db,
      [topic.author_id, ...posts.map((post) => post.author_id)].filter(Boolean) as string[],
    );
    const postsWithBadges = posts.map((post) => ({
      ...post,
      authorBadges: post.author_id ? (badges.get(post.author_id) ?? []) : [],
    }));

    return c.json({ ok: true, data: { topic, posts: postsWithBadges, likedPostIds } });
  });

  // ---- reply -----------------------------------------------------------
  router.post('/topics/:topicId/posts', rateLimitByUser('postCreate'), async (c) => {
    const body = await parseBody(c, createPostSchema);
    const handle = await getDb();
    const auth = c.get('auth');

    const topic = await getTopicById(handle.db, c.req.param('topicId'));
    if (!topic) throw errors.notFound('主题不存在');
    const board = await getBoardById(handle.db, topic.board_id);
    if (!board) throw errors.notFound('主题不存在');
    await assertCanViewResource(handle.db, auth?.subject ?? null, { type: 'board', id: board.id, policy: board.policy });
    // 发帖权限：仅管理员/站长的版块，普通用户与游客不能回帖。
    assertCanPostInBoard(auth?.subject ?? null, board);

    let authorId: string | null = null;
    let authorRole: 'member' | 'admin' | 'owner' | 'guest' = 'guest';
    let authorPostCount = 0;

    if (auth) {
      assertSubjectCanAct(auth.subject);
      assertPermission(auth.subject, PERMISSION.FORUM_POST_CREATE);
      authorId = auth.userId;
      authorRole = auth.subject.role;
      authorPostCount = await getPostCount(handle.db, auth.userId);
    } else if (board.policy.visibility !== 'public') {
      throw errors.loginRequired();
    }

    const post = await createPost(handle.db, {
      topicId: topic.id,
      authorId,
      authorPostCount,
      authorRole,
      contentMd: body.content,
      replyToPostId: body.replyToPostId,
    });

    // 回复通知：主题作者收到（作者自己回自己不提醒）。
    if (auth && topic.author_id && topic.author_id !== auth.userId) {
      const actor = await actorOf(handle.db, auth.userId);
      await createNotification(handle.db, {
        userId: topic.author_id,
        kind: 'reply',
        title: `${actor?.displayName ?? '有人'}回复了你的主题「${topic.title}」`,
        linkUrl: await topicLink(handle.db, topic.id),
        actor,
        topicId: topic.id,
        postId: post.id,
      });
    }
    return c.json({ ok: true, data: { post } }, 201);
  });

  // ---- post edit / delete / like --------------------------------------
  router.patch('/posts/:postId', requireAuth, async (c) => {
    const body = await parseBody(c, createPostSchema);
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const post = await editPost(handle.db, c.req.param('postId'), auth.userId, body.content);
    return c.json({ ok: true, data: { post } });
  });

  router.delete('/posts/:postId', requireAuth, async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const post = await getPostById(handle.db, c.req.param('postId'));
    if (!post) throw errors.notFound('帖子不存在');
    if (post.author_id === null) {
      // 访客内容只能由管理员/站长删除。
      assertPermission(auth.subject, PERMISSION.FORUM_POST_DELETE_ANY);
    } else if (post.author_id === auth.userId) {
      assertPermission(auth.subject, PERMISSION.FORUM_POST_DELETE_OWN);
    } else {
      assertPermission(auth.subject, PERMISSION.FORUM_POST_DELETE_ANY);
    }
    await deletePost(handle.db, post.id, auth.userId);
    // 管理动作留痕：删别人的帖子记 `admin.`，删自己的记 `forum.`。
    const own = post.author_id === auth.userId;
    await logAudit(handle.db, {
      actorId: auth.userId,
      actorIp: clientIp(c),
      action: own ? 'forum.post.deleted_own' : 'admin.post.deleted',
      targetType: 'post',
      targetId: post.id,
      meta: { topicId: post.topic_id, authorId: post.author_id },
    });
    // 管理员删别人的帖子 → 通知帖子作者（淡橙）。
    if (!own && post.author_id && post.topic_id) {
      const actor = await actorOf(handle.db, auth.userId);
      await createNotification(handle.db, {
        userId: post.author_id,
        kind: 'admin.post.deleted',
        title: '管理员删除了你的一条回复',
        body: '内容已删除，如有异议请联系站长。',
        isAdmin: true,
        actor,
        topicId: post.topic_id,
        postId: post.id,
        linkUrl: await topicLink(handle.db, post.topic_id),
      });
    }
    return c.json({ ok: true, data: null });
  });

  router.post('/posts/:postId/like', requireAuth, async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    assertSubjectCanAct(auth.subject);
    await likePost(handle.db, c.req.param('postId'), auth.userId);

    // 点赞通知：被赞帖子的作者（作者自己给自己点赞不提醒）。
    const post = await getPostById(handle.db, c.req.param('postId'));
    if (post?.author_id && post.author_id !== auth.userId && post.topic_id) {
      const actor = await actorOf(handle.db, auth.userId);
      await createNotification(handle.db, {
        userId: post.author_id,
        kind: 'like',
        title: `${actor?.displayName ?? '有人'}赞了你的帖子`,
        linkUrl: await topicLink(handle.db, post.topic_id),
        actor,
        topicId: post.topic_id,
        postId: post.id,
      });
    }
    return c.json({ ok: true, data: { liked: true } });
  });

  /** 分享通知：主题作者收到（同一浏览者 24 小时只提醒一次）。 */
  router.post('/topics/:topicId/share', requireAuth, async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    assertSubjectCanAct(auth.subject);
    const topic = await getTopicById(handle.db, c.req.param('topicId'));
    if (!topic || topic.status !== 'published') throw errors.notFound('主题不存在');
    if (topic.author_id && topic.author_id !== auth.userId) {
      const already = await hasRecentNotification(handle.db, {
        userId: topic.author_id,
        kind: 'share',
        topicId: topic.id,
        actorId: auth.userId,
      });
      if (!already) {
        const actor = await actorOf(handle.db, auth.userId);
        await createNotification(handle.db, {
          userId: topic.author_id,
          kind: 'share',
          title: `${actor?.displayName ?? '有人'}分享了你的主题「${topic.title}」`,
          linkUrl: await topicLink(handle.db, topic.id),
          actor,
          topicId: topic.id,
        });
      }
    }
    return c.json({ ok: true, data: { shared: true } });
  });

  router.post('/posts/:postId/unlike', requireAuth, async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    await unlikePost(handle.db, c.req.param('postId'), auth.userId);
    return c.json({ ok: true, data: { liked: false } });
  });

  // ---- moderator topic actions -----------------------------------------
  router.post('/topics/:topicId/action', requireAuth, async (c) => {
    const body = await parseBody(c, topicActionSchema);
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();

    const permissionMap: Record<string, (typeof PERMISSION)[keyof typeof PERMISSION]> = {
      pin: PERMISSION.FORUM_TOPIC_PIN,
      unpin: PERMISSION.FORUM_TOPIC_PIN,
      lock: PERMISSION.FORUM_TOPIC_LOCK,
      unlock: PERMISSION.FORUM_TOPIC_LOCK,
      delete: PERMISSION.FORUM_POST_DELETE_ANY,
      move: PERMISSION.FORUM_TOPIC_MOVE,
    };
    const permission = permissionMap[body.action];
    if (!permission) throw errors.validation({ issues: [{ path: 'action', message: '未知操作' }] });
    assertPermission(auth.subject, permission);

    const topic = await moderateTopic(handle.db, c.req.param('topicId'), body.action, {
      newBoardId: body.boardId,
      byId: auth.userId,
    });
    await logAudit(handle.db, {
      actorId: auth.userId,
      actorIp: clientIp(c),
      action: `admin.topic.${body.action}`,
      targetType: 'topic',
      targetId: topic.id,
      meta: { title: topic.title, newBoardId: body.boardId ?? null },
    });
    // 管理员删除他人主题 → 通知主题作者（淡橙）。
    if (body.action === 'delete' && topic.author_id && topic.author_id !== auth.userId) {
      const actor = await actorOf(handle.db, auth.userId);
      await createNotification(handle.db, {
        userId: topic.author_id,
        kind: 'admin.topic.deleted',
        title: `管理员删除了你的主题「${topic.title}」`,
        body: '内容已删除，如有异议请联系站长。',
        isAdmin: true,
        actor,
        topicId: topic.id,
      });
    }
    return c.json({ ok: true, data: { topic } });
  });

  router.delete('/topics/:topicId', requireAuth, async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const topic = await getTopicById(handle.db, c.req.param('topicId'));
    if (!topic) throw errors.notFound('主题不存在');
    if (topic.author_id === null) {
      assertPermission(auth.subject, PERMISSION.FORUM_POST_DELETE_ANY);
    } else if (topic.author_id === auth.userId) {
      assertPermission(auth.subject, PERMISSION.FORUM_POST_DELETE_OWN);
    } else {
      assertPermission(auth.subject, PERMISSION.FORUM_POST_DELETE_ANY);
    }
    await moderateTopic(handle.db, topic.id, 'delete', { byId: auth.userId });
    const own = topic.author_id === auth.userId;
    await logAudit(handle.db, {
      actorId: auth.userId,
      actorIp: clientIp(c),
      action: own ? 'forum.topic.deleted_own' : 'admin.topic.deleted',
      targetType: 'topic',
      targetId: topic.id,
      meta: { title: topic.title, boardId: topic.board_id, authorId: topic.author_id },
    });
    // 管理员删别人的主题 → 通知作者（淡橙）。
    if (!own && topic.author_id) {
      const actor = await actorOf(handle.db, auth.userId);
      await createNotification(handle.db, {
        userId: topic.author_id,
        kind: 'admin.topic.deleted',
        title: `管理员删除了你的主题「${topic.title}」`,
        body: '内容已删除，如有异议请联系站长。',
        isAdmin: true,
        actor,
        topicId: topic.id,
      });
    }
    return c.json({ ok: true, data: null });
  });

  // ---- 全站搜索（导航栏搜索框） --------------------------------------
  router.get('/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    const scope = c.req.query('scope') ?? 'all';
    const handle = await getDb();
    const subject = c.get('auth')?.subject ?? null;
    const lower = q.toLowerCase();

    const topics: Array<{
      id: string;
      title: string;
      boardSlug: string | null;
      authorUsername: string | null;
      authorDisplayName: string | null;
      createdAt: string;
      rank: number;
    }> = [];
    const users: Array<{
      id: string;
      username: string;
      displayName: string;
      avatarPath: string | null;
      role: string;
      level: number;
      bio: string;
      rank: number;
    }> = [];
    const cards: Array<{
      id: string;
      title: string;
      subtitle: string;
      rank: number;
    }> = [];

    if (q && (scope === 'all' || scope === 'topics' || scope === 'users' || scope === 'cards')) {
      if (scope === 'all' || scope === 'topics') {
        const rows = await searchTopics(handle.db, q, { limit: 8 });
        const boardIds = [...new Set(rows.map((row) => row.board_id))];
        const boards = boardIds.length
          ? await handle.db
              .select({ id: schema.boards.id, slug: schema.boards.slug })
              .from(schema.boards)
              .where(inArray(schema.boards.id, boardIds))
          : [];
        const slugOf = new Map(boards.map((board) => [board.id, board.slug]));
        for (const row of rows) {
          topics.push({
            id: row.id,
            title: row.title,
            boardSlug: slugOf.get(row.board_id) ?? null,
            authorUsername: row.authorUsername,
            authorDisplayName: row.authorDisplayName,
            createdAt: row.created_at.toISOString(),
            rank: rankOf(row.title, lower) * 2, // 标题命中权重更高
          });
        }
        topics.sort((a, b) => b.rank - a.rank);
      }

      if (scope === 'all' || scope === 'users') {
        const rows = await searchUsers(handle.db, q, 6);
        for (const row of rows) {
          users.push({
            id: row.id,
            username: row.username,
            displayName: row.displayName,
            avatarPath: row.avatarPath,
            role: row.role,
            level: row.level,
            bio: row.bio,
            // 用户名精确/前缀命中排最前
            rank: rankOf(row.displayName, lower) + (row.username.toLowerCase().startsWith(lower) ? 1 : 0),
          });
        }
        users.sort((a, b) => b.rank - a.rank);
      }

      if (scope === 'all' || scope === 'cards') {
        const rows = await searchCards(handle.db, subject, q, 6);
        for (const row of rows) {
          cards.push({
            id: row.id,
            title: row.title,
            subtitle: row.subtitle,
            rank: rankOf(row.title, lower) + (row.subtitle.toLowerCase().includes(lower) ? 1 : 0),
          });
        }
        cards.sort((a, b) => b.rank - a.rank);
      }
    }

    return c.json({ ok: true, data: { topics, users, cards } });
  });

  // ---- moderation queue (forum content) --------------------------------
  router.get('/moderation/pending', requirePermission(PERMISSION.FORUM_CONTENT_AUDIT), async (c) => {
    const handle = await getDb();
    const items = (await listQueued(handle.db, {})).filter(
      (item) => item.target_type === 'topic' || item.target_type === 'post',
    );
    return c.json({ ok: true, data: { items } });
  });

  router.post('/moderation/:itemId/decide', requirePermission(PERMISSION.FORUM_CONTENT_AUDIT), async (c) => {
    const body = await parseBody(c, decideSchema);
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();

    const items = await listQueued(handle.db, {});
    const item = items.find((entry) => entry.id === c.req.param('itemId'));
    if (!item || (item.target_type !== 'topic' && item.target_type !== 'post')) {
      throw errors.notFound('审核项不存在');
    }
    await decide(handle.db, item.id, { decision: body.decision, by: auth.userId, note: body.note });
    await logAudit(handle.db, {
      actorId: auth.userId,
      actorIp: clientIp(c),
      action: `moderation.${body.decision}`,
      targetType: item.target_type,
      targetId: item.target_id,
      meta: { itemId: item.id, note: body.note ?? null, reason: item.reason ?? null },
    });
    return c.json({ ok: true, data: null });
  });

  return router;
}