import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { getNotificationEventBus } from './events';

/**
 * 站内通知中心（notifications 表）。
 *
 * 点赞/分享/浏览/回复 按主题聚合为一条（count > 1 展开看具体是谁）；
 * 管理员/站长操作（删帖、审核卡片、处罚）单独成条，is_admin = 淡橙底。
 */

export type NotificationKind =
  | 'like'
  | 'share'
  | 'view'
  | 'reply'
  | 'admin.topic.deleted'
  | 'admin.post.deleted'
  | 'admin.card.approved'
  | 'admin.card.rejected'
  | 'admin.sanction'
  | 'system';

export interface NotificationActor {
  id?: string;
  username: string;
  displayName: string;
  avatarPath?: string | null;
}

export interface CreateNotificationInput {
  /** 收件人。 */
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  linkUrl?: string | null;
  actor?: NotificationActor | null;
  topicId?: string | null;
  postId?: string | null;
  cardId?: string | null;
  isAdmin?: boolean;
}

export async function createNotification(db: Db, input: CreateNotificationInput): Promise<void> {
  await db.insert(schema.notifications).values({
    user_id: input.userId,
    kind: input.kind,
    title: input.title,
    body: input.body ?? '',
    link_url: input.linkUrl ?? null,
    actor_id: input.actor?.id ?? null,
    actor_username: input.actor?.username ?? null,
    actor_display_name: input.actor?.displayName ?? null,
    actor_avatar_path: input.actor?.avatarPath ?? null,
    topic_id: input.topicId ?? null,
    post_id: input.postId ?? null,
    card_id: input.cardId ?? null,
    is_admin: input.isAdmin ?? false,
  });
  getNotificationEventBus().publish(input.userId, {
    type: 'notification.changed',
    data: { reason: 'created', at: new Date().toISOString() },
  });
}

/** 最近 24 小时里是否存在同一种类、同一目标的未读通知（用于浏览/分享节流）。 */
export async function hasRecentNotification(
  db: Db,
  opts: { userId: string; kind: NotificationKind; topicId?: string | null; actorId?: string | null },
): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.user_id, opts.userId),
        eq(schema.notifications.kind, opts.kind),
        sql`${schema.notifications.created_at} >= ${since}`,
        opts.topicId ? eq(schema.notifications.topic_id, opts.topicId) : sql`1 = 1`,
        opts.actorId ? eq(schema.notifications.actor_id, opts.actorId) : sql`1 = 1`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

function groupKeyOf(row: typeof schema.notifications.$inferSelect): string {
  // 主题相关的（点赞/分享/浏览/回复）按主题聚合；管理员操作/系统消息单条成组。
  if (row.topic_id) return `t:${row.kind}:${row.topic_id}`;
  if (row.card_id) return `c:${row.kind}:${row.card_id}`;
  return `i:${row.id}`;
}

export interface NotificationGroup {
  key: string;
  kind: string;
  title: string;
  body: string;
  linkUrl: string | null;
  isAdmin: boolean;
  count: number;
  unreadCount: number;
  latestAt: string;
  /** 聚合条目的具体触发者（展开用，最多 8 个）。 */
  actors: { id: string | null; username: string | null; displayName: string | null }[];
  /** 最近一条的原始时间。 */
  sampleCreatedAt: string;
}

/** 读最近 400 条，按「主题+种类」聚合成组，按最新时间倒序。 */
export async function listNotificationGroups(db: Db, userId: string): Promise<NotificationGroup[]> {
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.user_id, userId))
    .orderBy(desc(schema.notifications.created_at))
    .limit(400);

  const groups = new Map<string, NotificationGroup>();
  for (const row of rows) {
    const key = groupKeyOf(row);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        kind: row.kind,
        title: row.title,
        body: row.body,
        linkUrl: row.link_url,
        isAdmin: row.is_admin,
        count: 0,
        unreadCount: 0,
        latestAt: row.created_at.toISOString(),
        actors: [],
        sampleCreatedAt: row.created_at.toISOString(),
      };
      groups.set(key, group);
    }
    group.count += 1;
    if (!row.read_at) group.unreadCount += 1;
    if (row.actor_username && group.actors.length < 8) {
      group.actors.push({
        id: row.actor_id,
        username: row.actor_username,
        displayName: row.actor_display_name ?? row.actor_username,
      });
    }
  }

  return [...groups.values()].sort((a, b) => (a.latestAt < b.latestAt ? 1 : -1));
}

export async function notificationUnreadCount(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.user_id, userId), isNull(schema.notifications.read_at)));
  return rows[0]?.n ?? 0;
}

/**
 * 把一组通知标记为已读。
 * keys 格式与 listNotificationGroups 的 key 一致：
 * - `t:<kind>:<topicId>`  把该主题该种类全部已读
 * - `c:<kind>:<cardId>`   卡片类
 * - `i:<id>`              单条
 * 传 ['*'] 或空数组 = 全部标记已读。
 */
export async function markNotificationsRead(db: Db, userId: string, keys: string[]): Promise<void> {
  if (keys.length === 0 || keys.includes('*')) {
    await db
      .update(schema.notifications)
      .set({ read_at: new Date() })
      .where(and(eq(schema.notifications.user_id, userId), isNull(schema.notifications.read_at)));
    return;
  }
  for (const key of keys) {
    if (key.startsWith('t:')) {
      const [, kind, topicId] = key.split(':');
      if (!kind || !topicId) continue;
      await db
        .update(schema.notifications)
        .set({ read_at: new Date() })
        .where(
          and(
            eq(schema.notifications.user_id, userId),
            eq(schema.notifications.kind, kind),
            eq(schema.notifications.topic_id, topicId),
            isNull(schema.notifications.read_at),
          ),
        );
    } else if (key.startsWith('c:')) {
      const [, kind, cardId] = key.split(':');
      if (!kind || !cardId) continue;
      await db
        .update(schema.notifications)
        .set({ read_at: new Date() })
        .where(
          and(
            eq(schema.notifications.user_id, userId),
            eq(schema.notifications.kind, kind),
            eq(schema.notifications.card_id, cardId),
            isNull(schema.notifications.read_at),
          ),
        );
    } else if (key.startsWith('i:')) {
      const id = key.slice(2);
      await db
        .update(schema.notifications)
        .set({ read_at: new Date() })
        .where(
          and(eq(schema.notifications.user_id, userId), eq(schema.notifications.id, id), isNull(schema.notifications.read_at)),
        );
    }
  }
}