import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { accessPolicyJsonb } from './access';
import { createdAtColumn, deletedAtColumn, updatedAtColumn } from './helpers';
import { users } from './identity';

export const resourceStatusEnum = pgEnum('resource_status', [
  'draft',
  'pending_review',
  'published',
  'rejected',
  'archived',
]);

export const linkStatusEnum = pgEnum('link_status', ['active', 'dead', 'under_review', 'disabled']);

export const downloadCategories = pgTable(
  'download_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: varchar('name', { length: 60 }).notNull(),
    description: text('description').notNull().default(''),
    sort_order: integer('sort_order').notNull().default(0),
    ...accessPolicyJsonb,
    archived_at: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    created_at: createdAtColumn(),
    updated_at: updatedAtColumn(),
  },
  (table) => [index('download_categories_sort_idx').on(table.sort_order)],
);

export const downloadResources = pgTable(
  'download_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    category_id: uuid('category_id')
      .notNull()
      .references(() => downloadCategories.id),
    /** The uploading admin. Owners self-publish; admin uploads need review. */
    author_id: uuid('author_id')
      .notNull()
      .references(() => users.id),
    title: varchar('title', { length: 80 }).notNull(),
    slug: text('slug').notNull().unique(),
    summary: varchar('summary', { length: 300 }).notNull().default(''),
    description_md: text('description_md').notNull().default(''),
    cover_path: text('cover_path'),
    version_label: varchar('version_label', { length: 40 }),
    /** external (netdisk/CDN link) or local (hosted file). */
    source_type: text('source_type').notNull().default('external'),
    status: resourceStatusEnum('status').notNull().default('draft'),
    ...accessPolicyJsonb,
    review_note: text('review_note'),
    reviewed_by: uuid('reviewed_by'),
    reviewed_at: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
    published_at: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    download_count: integer('download_count').notNull().default(0),
    view_count: integer('view_count').notNull().default(0),
    created_at: createdAtColumn(),
    updated_at: updatedAtColumn(),
    deleted_at: deletedAtColumn(),
  },
  (table) => [
    index('download_resources_status_idx').on(table.status, table.published_at),
    index('download_resources_category_idx').on(table.category_id),
    index('download_resources_author_idx').on(table.author_id),
  ],
);

export const downloadLinks = pgTable(
  'download_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resource_id: uuid('resource_id')
      .notNull()
      .references(() => downloadResources.id, { onDelete: 'cascade' }),
    /** primary | mirror */
    kind: text('kind').notNull().default('primary'),
    /** external | local */
    source_type: text('source_type').notNull(),
    /**
     * The external URL. SECURITY: this column never appears in any list/detail
     * API response — only the gated fetch endpoint may read it, and it answers
     * with a redirect, not the URL. Verified by a dedicated security regression
     * test.
     */
    url: text('url'),
    /** 网盘提取码 — same security posture as `url`: gated fetch only. */
    extract_code: varchar('extract_code', { length: 32 }),
    /** Filesystem path relative to the uploads root (local links only). */
    local_path: text('local_path'),
    file_name: text('file_name'),
    size_bytes: bigint('size_bytes', { mode: 'number' }),
    checksum_sha256: varchar('checksum_sha256', { length: 64 }),
    status: linkStatusEnum('status').notNull().default('active'),
    reported_dead_count: integer('reported_dead_count').notNull().default(0),
    sort_order: integer('sort_order').notNull().default(0),
    created_at: createdAtColumn(),
    updated_at: updatedAtColumn(),
  },
  (table) => [
    index('download_links_resource_idx').on(table.resource_id),
    index('download_links_status_idx').on(table.status),
  ],
);

/** Dead-link reports; `reported_dead_count` on the link is the denormalized total. */
export const downloadReports = pgTable(
  'download_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resource_id: uuid('resource_id')
      .notNull()
      .references(() => downloadResources.id),
    link_id: uuid('link_id').references(() => downloadLinks.id),
    reporter_id: uuid('reporter_id')
      .notNull()
      .references(() => users.id),
    reason: text('reason'),
    resolved_at: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    resolved_by: uuid('resolved_by'),
    created_at: createdAtColumn(),
  },
  (table) => [index('download_reports_resolved_idx').on(table.resolved_at)],
);

/**
 * One row per fetch. Powers download counts, the daily quota, and the audit
 * trail — three consumers, one source of truth.
 */
export const downloadLogs = pgTable(
  'download_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resource_id: uuid('resource_id')
      .notNull()
      .references(() => downloadResources.id),
    link_id: uuid('link_id').references(() => downloadLinks.id),
    user_id: uuid('user_id').references(() => users.id),
    ip: text('ip'),
    user_agent: text('user_agent'),
    created_at: createdAtColumn(),
  },
  (table) => [
    index('download_logs_user_time_idx').on(table.user_id, table.created_at),
    index('download_logs_resource_time_idx').on(table.resource_id, table.created_at),
  ],
);

export const downloadCardKindEnum = pgEnum('download_card_kind', ['container', 'redirect', 'resources']);

/**
 * 下载区卡片门户：管理员可无限嵌套的树状卡片。
 * - kind=container  → 点进去显示子卡片（套娃）
 * - kind=redirect   → 点进去重定向到 redirect_url
 * - kind=resources  → 点进去显示资源列表（走现有下载逻辑）
 * - w/h 是网格单位尺寸（后台可视化拖拽缩放）
 * - visibility：public=访客可见 / login=需登录 / invite=需绑定过注册码 / staff=仅管理员/站长
 */
export const downloadCards = pgTable(
  'download_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parent_id: uuid('parent_id').references((): AnyPgColumn => downloadCards.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 80 }).notNull(),
    subtitle: varchar('subtitle', { length: 200 }).notNull().default(''),
    kind: downloadCardKindEnum('kind').notNull().default('container'),
    redirect_url: text('redirect_url'),
    w: integer('w').notNull().default(1),
    h: integer('h').notNull().default(1),
    visibility: text('visibility').notNull().default('public'),
    position: integer('position').notNull().default(0),
    created_at: createdAtColumn(),
    updated_at: updatedAtColumn(),
  },
  (table) => [index('download_cards_parent_idx').on(table.parent_id)],
);