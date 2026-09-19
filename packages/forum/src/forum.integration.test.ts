import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import { hashPassword } from '@ycomm/identity';
import {
  createPost,
  createTopic,
  editPost,
  getPostCount,
  likePost,
  listPosts,
  listTopics,
  moderateTopic,
  searchTopics,
  registerForumDeciders,
} from './index';

let handle: DatabaseHandle;

async function seedUser(username: string, opts: { postCount?: number } = {}): Promise<string> {
  const [row] = await handle.db
    .insert(schema.users)
    .values({
      username,
      email: `${username}@example.com`,
      password_hash: await hashPassword('password-1'),
      state: 'active',
      display_name: username,
      post_count: opts.postCount ?? 0,
    })
    .returning({ id: schema.users.id });
  if (!row) throw new Error('no user');
  return row.id;
}

async function seedBoard(): Promise<string> {
  const [row] = await handle.db
    .insert(schema.boards)
    .values({
      slug: 'test',
      name: '测试版',
      description: '',
      access_policy: { visibility: 'login', minLevel: 0, requireInvite: false },
    })
    .returning({ id: schema.boards.id });
  if (!row) throw new Error('no board');
  return row.id;
}

beforeAll(async () => {
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations');
  handle = await createInMemoryDb({ migrationsFolder });
  await handle.runMigrations();
  registerForumDeciders();
});

afterEach(async () => {
  for (const table of [
    schema.moderationItems,
    schema.postRevisions,
    schema.posts,
    schema.topics,
    schema.boards,
    schema.reactions,
    schema.users,
  ]) {
    await handle.db.delete(table);
  }
});

describe('topics', () => {
  it('列表按发表时间倒序（越新越靠上）；置顶仍在最前；回复不改变主题顺序', async () => {
    const boardId = await seedBoard();
    const author = await seedUser('timeline');

    const older = await createTopic(handle.db, {
      boardId,
      authorId: author,
      authorPostCount: 0,
      authorRole: 'member',
      title: '最早发表',
      contentMd: '一',
    });
    // 让 created_at 明确拉开（同一毫秒内创建的排序不稳定）
    await handle.db
      .update(schema.topics)
      .set({ created_at: new Date(Date.now() - 60_000), last_post_at: new Date(Date.now() - 60_000) })
      .where(eq(schema.topics.id, older.topic.id));

    const middle = await createTopic(handle.db, {
      boardId,
      authorId: author,
      authorPostCount: 0,
      authorRole: 'member',
      title: '中间发表',
      contentMd: '二',
    });
    expect(middle.topic.status).toBe('published');
    const newest = await createTopic(handle.db, {
      boardId,
      authorId: author,
      authorPostCount: 0,
      authorRole: 'member',
      title: '最新发表',
      contentMd: '三',
    });

    // 给「最早发表」回一帖：旧规则（按最后回复时间排）会把它顶到最上面，新规则不会。
    await createPost(handle.db, {
      topicId: older.topic.id,
      authorId: author,
      authorPostCount: 0,
      authorRole: 'member',
      contentMd: '回复一下',
    });

    const titles = async () => (await listTopics(handle.db, { boardId })).topics.map((topic) => topic.title);
    expect(await titles()).toEqual(['最新发表', '中间发表', '最早发表']);

    // 置顶的主题始终在最前面（行首有 📌 标记）。
    await moderateTopic(handle.db, older.topic.id, 'pin');
    expect(await titles()).toEqual(['最早发表', '最新发表', '中间发表']);

    // 时间字段都带出来了（列表要显示发表时间）。
    const listed = (await listTopics(handle.db, { boardId })).topics;
    expect(listed.find((topic) => topic.id === newest.topic.id)?.created_at).toBeInstanceOf(Date);
  });

  it('new members publish directly (new-member review queue disabled)', async () => {
    const boardId = await seedBoard();
    const newbie = await seedUser('newbie');
    const active = await seedUser('active', { postCount: 5 });

    const result = await createTopic(handle.db, {
      boardId,
      authorId: newbie,
      authorPostCount: await getPostCount(handle.db, newbie),
      authorRole: 'member',
      title: '新人第一帖',
      contentMd: '大家好',
    });
    // MODERATION.newMemberReviewPostCount = 0：新成员同样直接发布，不进审核队列。
    expect(result.needsReview).toBe(false);
    expect(result.topic.status).toBe('published');

    const items = await handle.db
      .select()
      .from(schema.moderationItems)
      .where(eq(schema.moderationItems.reason, 'new_user_review'));
    expect(items).toHaveLength(0);

    const direct = await createTopic(handle.db, {
      boardId,
      authorId: active,
      authorPostCount: await getPostCount(handle.db, active),
      authorRole: 'member',
      title: '老用户直接发布',
      contentMd: '大家好',
    });
    expect(direct.needsReview).toBe(false);
    expect(direct.topic.status).toBe('published');
  });

  it('post counts and board counters move with topic creation', async () => {
    const boardId = await seedBoard();
    const user = await seedUser('counter', { postCount: 5 });
    await createTopic(handle.db, {
      boardId,
      authorId: user,
      authorPostCount: 5,
      authorRole: 'member',
      title: '计数测试',
      contentMd: 'x',
    });
    expect(await getPostCount(handle.db, user)).toBe(6);

    const boards = await handle.db.select().from(schema.boards).where(eq(schema.boards.id, boardId));
    expect(boards[0]?.topic_count).toBe(1);
  });

  it('moderators can pin, lock and move', async () => {
    const boardId = await seedBoard();
    const author = await seedUser('author', { postCount: 10 });
    const { topic } = await createTopic(handle.db, {
      boardId,
      authorId: author,
      authorPostCount: 10,
      authorRole: 'member',
      title: '管理操作',
      contentMd: 'x',
    });

    const pinned = await moderateTopic(handle.db, topic.id, 'pin');
    expect(pinned.is_pinned).toBe(true);
    const locked = await moderateTopic(handle.db, topic.id, 'lock');
    expect(locked.is_locked).toBe(true);
    const moved = await moderateTopic(handle.db, topic.id, 'move', { newBoardId: boardId });
    expect(moved.board_id).toBe(boardId);
  });

  it('search finds topics by title', async () => {
    const boardId = await seedBoard();
    const author = await seedUser('author', { postCount: 10 });
    await createTopic(handle.db, {
      boardId,
      authorId: author,
      authorPostCount: 10,
      authorRole: 'member',
      title: 'Docker 部署指南',
      contentMd: '一步步来',
    });
    const results = await searchTopics(handle.db, 'docker', {});
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Docker 部署指南');
  });
});

describe('posts', () => {
  it('replies increment positions and counter', async () => {
    const boardId = await seedBoard();
    const author = await seedUser('author', { postCount: 10 });
    const { topic } = await createTopic(handle.db, {
      boardId,
      authorId: author,
      authorPostCount: 10,
      authorRole: 'member',
      title: '回帖测试',
      contentMd: 'op',
    });

    const reply = await createPost(handle.db, {
      topicId: topic.id,
      authorId: author,
      authorPostCount: 10,
      authorRole: 'member',
      contentMd: 'reply-1',
    });
    expect(reply.position).toBe(2);
    expect(reply.status).toBe('published');

    const { posts, total } = await listPosts(handle.db, topic.id, {});
    expect(posts).toHaveLength(2);
    expect(total).toBe(2);
    expect(await getPostCount(handle.db, author)).toBe(12); // topic + reply
  });

  it('edit keeps a revision and a window; expired edits are refused', async () => {
    const boardId = await seedBoard();
    const author = await seedUser('author', { postCount: 10 });
    await createTopic(handle.db, {
      boardId,
      authorId: author,
      authorPostCount: 10,
      authorRole: 'member',
      title: '编辑测试',
      contentMd: 'original',
    });

    // The opening post of a topic is a `posts` row (position 1). Fetch it — the
    // topic row itself is NOT a post and cannot be edited.
    const [op] = await handle.db.select().from(schema.posts).where(eq(schema.posts.position, 1));
    if (!op) throw new Error('no op post');

    const editedPost = await editPost(handle.db, op.id, author, 'updated');
    expect(editedPost.content_md).toBe('updated');
    expect(editedPost.edit_count).toBe(1);

    const revisions = await handle.db
      .select()
      .from(schema.postRevisions)
      .where(eq(schema.postRevisions.post_id, op.id));
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.content_md).toBe('original');

    // Expire the edit window by backdating the post.
    await handle.db
      .update(schema.posts)
      .set({ created_at: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(schema.posts.id, op.id));
    await expect(editPost(handle.db, op.id, author, 'too-late')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('likes increment the author counter exactly once', async () => {
    const boardId = await seedBoard();
    const author = await seedUser('author', { postCount: 10 });
    const liker = await seedUser('liker', { postCount: 10 });
    await createTopic(handle.db, {
      boardId,
      authorId: author,
      authorPostCount: 10,
      authorRole: 'member',
      title: '点赞测试',
      contentMd: 'op',
    });
    const [postRow] = await handle.db.select().from(schema.posts).where(eq(schema.posts.position, 1));
    if (!postRow) throw new Error('no post');

    await likePost(handle.db, postRow.id, liker);
    await likePost(handle.db, postRow.id, liker); // duplicate — must not double count
    const [userRow] = await handle.db.select().from(schema.users).where(eq(schema.users.id, author));
    expect(userRow?.like_received_count).toBe(1);
  });
});

describe('guests and banned words', () => {
  it('guests can post in public boards as 访客 without review', async () => {
    const [publicBoard] = await handle.db
      .insert(schema.boards)
      .values({
        slug: 'public',
        name: '公开板',
        description: '',
        access_policy: { visibility: 'public', minLevel: 0, requireInvite: false },
      })
      .returning({ id: schema.boards.id });
    if (!publicBoard) throw new Error('no board');

    const result = await createTopic(handle.db, {
      boardId: publicBoard.id,
      authorId: null,
      authorPostCount: 0,
      authorRole: 'guest',
      title: '访客主题',
      contentMd: '访客可以在公开板块发言',
    });
    expect(result.needsReview).toBe(false);
    expect(result.topic.status).toBe('published');

    const { topics } = await listTopics(handle.db, { boardId: publicBoard.id });
    expect(topics[0]?.authorUsername).toBeNull();
  });

  it('rejects content containing an admin-configured banned word', async () => {
    const boardId = await seedBoard();
    const author = await seedUser('author', { postCount: 10 });
    await handle.db.insert(schema.settings).values({ key: 'bannedWords', value: ['违禁词'] });

    await expect(
      createTopic(handle.db, {
        boardId,
        authorId: author,
        authorPostCount: 10,
        authorRole: 'member',
        title: '正常标题',
        contentMd: '这里包含违禁词测试',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await handle.db.delete(schema.settings);
  });
});

describe('listing', () => {
  it('listTopics returns published topics of a board', async () => {
    const boardId = await seedBoard();
    const author = await seedUser('author', { postCount: 10 });
    await createTopic(handle.db, {
      boardId,
      authorId: author,
      authorPostCount: 10,
      authorRole: 'member',
      title: '可见主题',
      contentMd: 'x',
    });
    const { topics, total } = await listTopics(handle.db, { boardId });
    expect(total).toBe(1);
    expect(topics[0]?.title).toBe('可见主题');
  });
});