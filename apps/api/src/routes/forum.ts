import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { getDb } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import { PERMISSION } from '@ycomm/config';
import { assertCanViewResource, assertPermission, assertSubjectCanAct } from '@ycomm/access';
import {
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
  moderateTopic,
  searchTopics,
  unlikePost,
} from '@ycomm/forum';
import { decide, listQueued } from '@ycomm/moderation';
import type { AppVariables } from '../context';
import { requireAuth, sessionAuth } from '../middleware/session';
import { requirePermission } from '../middleware/permission';
import { rateLimitByUser } from '../middleware/rate-limit';

export async function parseBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const body = await c.req.json().catch(() => ({}));
  const result = schema.safeParse(body);
  if (!result.success) {
    throw errors.validation({
      issues: result.error.issues.map((issue) => ({ path: issue.path.join('.') || '(root)', message: issue.message })),
    });
  }
  return result.data;
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
    return c.json({ ok: true, data: result });
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
    }

    return c.json({ ok: true, data: { topic, posts, likedPostIds } });
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
    return c.json({ ok: true, data: null });
  });

  router.post('/posts/:postId/like', requireAuth, async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    assertSubjectCanAct(auth.subject);
    await likePost(handle.db, c.req.param('postId'), auth.userId);
    return c.json({ ok: true, data: { liked: true } });
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
    return c.json({ ok: true, data: null });
  });

  // ---- search ----------------------------------------------------------
  router.get('/search', async (c) => {
    const q = c.req.query('q') ?? '';
    const handle = await getDb();
    const topics = await searchTopics(handle.db, q, {});
    return c.json({ ok: true, data: { topics } });
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
    return c.json({ ok: true, data: null });
  });

  return router;
}