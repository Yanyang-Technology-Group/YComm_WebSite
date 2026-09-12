import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { accessPolicyJsonb } from './access';
import { createdAtColumn, deletedAtColumn, updatedAtColumn } from './helpers';
import { users } from './identity';

export const contentStatusEnum = pgEnum('content_status', ['published', 'pending', 'deleted', 'hidden']);

export const boards = pgTable(
  'boards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: varchar('name', { length: 60 }).notNull(),
    description: text('description').notNull().default(''),
    /**
     * One level of grouping (a category containing boards). No foreign key on
     * purpose: self-references on polymorphic aggregates buy little and cost a
     * lot of migration friction. Referential integrity is enforced in code.
     */
    parent_id: uuid('parent_id'),
    sort_order: integer('sort_order').notNull().default(0),
    ...accessPolicyJsonb,
    topic_count: integer('topic_count').notNull().default(0),
    post_count: integer('post_count').notNull().default(0),
    archived_at: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    created_at: createdAtColumn(),
    updated_at: updatedAtColumn(),
  },
  (table) => [index('boards_parent_id_idx').on(table.parent_id)],
);

export const topics = pgTable(
  'topics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    board_id: uuid('board_id')
      .notNull()
      .references(() => boards.id),
    /**
     * NULL for guest posts (visitors may post in public boards); guests are
     * shown as「访客」. FK is set-null so deleting a user keeps their content,
     * anonymized.
     */
    author_id: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    title: varchar('title', { length: 120 }).notNull(),
    /** Unique per board; derived from the title at creation time. */
    slug: varchar('slug', { length: 160 }).notNull(),
    is_pinned: boolean('is_pinned').notNull().default(false),
    is_locked: boolean('is_locked').notNull().default(false),
    status: contentStatusEnum('status').notNull().default('published'),
    reply_count: integer('reply_count').notNull().default(0),
    view_count: integer('view_count').notNull().default(0),
    last_post_at: timestamp('last_post_at', { withTimezone: true, mode: 'date' }),
    last_post_author_id: uuid('last_post_author_id'),
    created_at: createdAtColumn(),
    updated_at: updatedAtColumn(),
    deleted_at: deletedAtColumn(),
    deleted_by: uuid('deleted_by'),
  },
  (table) => [
    uniqueIndex('topics_board_slug_unique').on(table.board_id, table.slug),
    index('topics_board_status_idx').on(table.board_id, table.status, table.is_pinned, table.last_post_at),
    index('topics_author_id_idx').on(table.author_id),
    index('topics_created_at_idx').on(table.created_at),
  ],
);

/** Every post, including the opening post of a topic (`position = 1`). */
export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topic_id: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    /** NULL for guest posts — see topics.author_id. */
    author_id: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    /** 1 = the topic's opening post. Uniqueness with topic_id below. */
    position: integer('position').notNull(),
    content_md: text('content_md').notNull(),
    status: contentStatusEnum('status').notNull().default('published'),
    /** 楼中楼 support; plain uuid, referential integrity enforced in code. */
    reply_to_post_id: uuid('reply_to_post_id'),
    edited_at: timestamp('edited_at', { withTimezone: true, mode: 'date' }),
    edit_count: integer('edit_count').notNull().default(0),
    created_at: createdAtColumn(),
    deleted_at: deletedAtColumn(),
    deleted_by: uuid('deleted_by'),
  },
  (table) => [
    uniqueIndex('posts_topic_position_unique').on(table.topic_id, table.position),
    index('posts_author_id_idx').on(table.author_id),
  ],
);

/** Every edit is retained — needed for review, appeals, and anti-evasion. */
export const postRevisions = pgTable(
  'post_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    post_id: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    content_md: text('content_md').notNull(),
    edited_by: uuid('edited_by').references(() => users.id),
    created_at: createdAtColumn(),
  },
  (table) => [index('post_revisions_post_id_idx').on(table.post_id)],
);

export const reactions = pgTable(
  'reactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** post | topic */
    target_type: text('target_type').notNull(),
    target_id: uuid('target_id').notNull(),
    kind: text('kind').notNull().default('like'),
    created_at: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('reactions_user_target_unique').on(table.user_id, table.target_type, table.target_id),
    index('reactions_target_idx').on(table.target_type, table.target_id),
    // The count feeding the level calculation cannot drift if it is computed
    // from the same table the posts are judged on.
    index('reactions_kind_created_idx').on(table.kind, table.created_at),
  ],
);