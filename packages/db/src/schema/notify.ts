import { index, pgTable, text, timestamp, uuid, boolean } from 'drizzle-orm/pg-core';
import { createdAtColumn } from './helpers';
import { users } from './identity';
import { topics, posts } from './forum';
import { downloadCards } from './downloads';

/**
 * In-app notifications. Email side effects are recorded in `emailLogs`.
 *
 * 站内通知中心：点赞/分享/浏览/回复 按主题聚合，管理员/站长操作（删帖、审核卡片、
 * 处罚）单独成条（is_admin = 列表里淡橙底）。actor 快照字段避免注销后查不到是谁。
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 收件人。 */
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** like | share | view | reply | admin.topic.deleted | admin.post.deleted | admin.card.approved | admin.card.rejected | admin.sanction | system */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    link_url: text('link_url'),
    /** 触发者（注销后被置空，靠快照字段展示名字）。 */
    actor_id: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actor_username: text('actor_username'),
    actor_display_name: text('actor_display_name'),
    actor_avatar_path: text('actor_avatar_path'),
    topic_id: uuid('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    post_id: uuid('post_id').references(() => posts.id, { onDelete: 'set null' }),
    card_id: uuid('card_id').references(() => downloadCards.id, { onDelete: 'set null' }),
    /** 管理员/站长操作类通知（列表里淡橙底）。 */
    is_admin: boolean('is_admin').notNull().default(false),
    read_at: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    created_at: createdAtColumn(),
  },
  (table) => [
    index('notifications_user_unread_idx').on(table.user_id, table.read_at),
    index('notifications_target_idx').on(table.kind, table.topic_id),
  ],
);

/**
 * Permanent record of every mail attempt — a self-hosted mail setup without
 * this is impossible to debug ("user says they never got the email").
 */
export const emailLogs = pgTable(
  'email_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    to_email: text('to_email').notNull(),
    template: text('template').notNull(),
    subject: text('subject').notNull(),
    /** sent | failed | skipped */
    status: text('status').notNull(),
    error: text('error'),
    created_at: createdAtColumn(),
  },
  (table) => [index('email_logs_recipient_idx').on(table.to_email, table.created_at)],
);