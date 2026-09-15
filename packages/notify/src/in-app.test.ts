import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import { hashPassword } from '@ycomm/identity';
import { parseAccessPolicy } from '@ycomm/config';
import {
  createNotification,
  hasRecentNotification,
  listNotificationGroups,
  markNotificationsRead,
  notificationUnreadCount,
} from './index';

let handle: DatabaseHandle;
let authorId = '';
let viewerId = '';
let topicCounter = 0;

beforeEach(async () => {
  authorId = await seedUser('notif-author');
  viewerId = await seedUser('notif-viewer');
});

beforeAll(async () => {
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations');
  handle = await createInMemoryDb({ migrationsFolder });
  await handle.runMigrations();
});

afterEach(async () => {
  for (const table of [schema.notifications, schema.posts, schema.topics, schema.boards, schema.users]) {
    await handle.db.delete(table);
  }
});

async function seedUser(username: string): Promise<string> {
  const [row] = await handle.db
    .insert(schema.users)
    .values({
      username,
      email: `${username}@example.com`,
      password_hash: await hashPassword('password-1'),
      role: 'member',
      state: 'active',
      display_name: username,
    })
    .returning({ id: schema.users.id });
  if (!row) throw new Error('no user');
  return row.id;
}

/** 建一个真实主题（notifications.topic_id 有外键，不能用假 UUID）。 */
async function seedTopic(title: string): Promise<string> {
  topicCounter += 1;
  const [board] = await handle.db
    .insert(schema.boards)
    .values({
      slug: `notif-board-${topicCounter}`,
      name: '通知测试',
      description: '',
      access_policy: parseAccessPolicy({ visibility: 'public' }),
      posting_policy: 'all',
    })
    .returning({ id: schema.boards.id });
  if (!board) throw new Error('no board');
  const [topic] = await handle.db
    .insert(schema.topics)
    .values({
      board_id: board.id,
      author_id: authorId,
      title,
      slug: `notif-topic-${topicCounter}`,
      status: 'published',
    })
    .returning({ id: schema.topics.id });
  if (!topic) throw new Error('no topic');
  return topic.id;
}

describe('in-app notifications', () => {
  it('点赞按主题聚合、未读数正确、标记已读后归零', async () => {
    const topicId = await seedTopic('聚合测试');
    const user2 = await seedUser('notif-user2');
    const actor = { id: viewerId, username: 'notif-viewer', displayName: 'notif-viewer' };

    await createNotification(handle.db, {
      userId: authorId,
      kind: 'like',
      title: 'notif-viewer 赞了你的帖子',
      actor,
      topicId,
    });
    await createNotification(handle.db, {
      userId: authorId,
      kind: 'like',
      title: '另一个用户赞了你的帖子',
      actor: { id: user2, username: 'notif-user2', displayName: 'notif-user2' },
      topicId,
    });

    expect(await notificationUnreadCount(handle.db, authorId)).toBe(2);

    const groups = await listNotificationGroups(handle.db, authorId);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe('like');
    expect(groups[0]?.count).toBe(2);
    expect(groups[0]?.unreadCount).toBe(2);
    expect(groups[0]?.actors.map((item) => item.username).sort()).toEqual(['notif-user2', 'notif-viewer']);

    await markNotificationsRead(handle.db, authorId, [groups[0]?.key ?? '']);
    expect(await notificationUnreadCount(handle.db, authorId)).toBe(0);
    expect((await listNotificationGroups(handle.db, authorId))[0]?.unreadCount).toBe(0);
  });

  it('管理员操作通知不进主题聚合（不同主题独立成条、is_admin 标记）', async () => {
    const topicA = await seedTopic('被删主题 A');
    const topicB = await seedTopic('被删主题 B');
    await createNotification(handle.db, {
      userId: authorId,
      kind: 'admin.topic.deleted',
      title: '管理员删除了你的主题「被删主题 A」',
      isAdmin: true,
      topicId: topicA,
    });
    await createNotification(handle.db, {
      userId: authorId,
      kind: 'admin.topic.deleted',
      title: '管理员删除了你的主题「被删主题 B」',
      isAdmin: true,
      topicId: topicB,
    });

    const groups = await listNotificationGroups(handle.db, authorId);
    expect(groups).toHaveLength(2); // 管理通知按主题各成一组
    expect(groups.every((group) => group.isAdmin)).toBe(true);
  });

  it('hasRecentNotification：24 小时内同浏览者不再重复提醒', async () => {
    const topicId = await seedTopic('浏览提醒');
    expect(await hasRecentNotification(handle.db, { userId: authorId, kind: 'view', topicId, actorId: viewerId })).toBe(false);

    await createNotification(handle.db, {
      userId: authorId,
      kind: 'view',
      title: '你的主题被浏览了',
      actor: { id: viewerId, username: 'notif-viewer', displayName: 'notif-viewer' },
      topicId,
    });

    expect(await hasRecentNotification(handle.db, { userId: authorId, kind: 'view', topicId, actorId: viewerId })).toBe(true);
  });

  it('markNotificationsRead 传空数组 = 全部已读', async () => {
    const topicId = await seedTopic('全部已读');
    await createNotification(handle.db, {
      userId: authorId,
      kind: 'reply',
      title: '有人回复了你的主题',
      actor: { id: viewerId, username: 'notif-viewer', displayName: 'notif-viewer' },
      topicId,
    });
    await createNotification(handle.db, {
      userId: authorId,
      kind: 'admin.sanction',
      title: '你的账号已被禁言',
      isAdmin: true,
    });

    await markNotificationsRead(handle.db, authorId, []);
    expect(await notificationUnreadCount(handle.db, authorId)).toBe(0);
  });
});