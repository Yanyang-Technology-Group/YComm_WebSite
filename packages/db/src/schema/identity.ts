import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAtColumn, updatedAtColumn } from './helpers';

/**
 * `guest` is not a database value — an absent session *is* the guest. Persisted
 * roles are only member/admin/owner; see `config/roles.ts` for the matrix.
 */
export const userRoleEnum = pgEnum('user_role', ['member', 'admin', 'owner']);

/** Account state acts as the first gate of every access decision. */
export const userStateEnum = pgEnum('user_state', [
  'unverified',
  'active',
  'muted',
  'banned',
  /** 注销确认期：3 天内登录可取消，到期自动转 deleted。 */
  'deleting',
  'deleted',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: varchar('username', { length: 20 }).notNull(),
    email: text('email').notNull(),
    /** argon2id hash; NULL for accounts created through OAuth alone. */
    password_hash: text('password_hash'),
    role: userRoleEnum('role').notNull().default('member'),
    state: userStateEnum('state').notNull().default('unverified'),
    /** Derived value; recomputed on activity events and nightly. See config/policy.ts. */
    level: integer('level').notNull().default(0),
    level_updated_at: timestamp('level_updated_at', { withTimezone: true, mode: 'date' }),
    display_name: varchar('display_name', { length: 40 }).notNull().default(''),
    avatar_path: text('avatar_path'),
    bio: text('bio').notNull().default(''),
    post_count: integer('post_count').notNull().default(0),
    like_received_count: integer('like_received_count').notNull().default(0),
    /** Which user's invite code created this account (may be NULL). */
    invited_by: uuid('invited_by'),
    muted_until: timestamp('muted_until', { withTimezone: true, mode: 'date' }),
    mute_reason: text('mute_reason'),
    ban_reason: text('ban_reason'),
    /** 封禁到期时间；NULL = 永久封禁。到期后自动解除。 */
    banned_until: timestamp('banned_until', { withTimezone: true, mode: 'date' }),
    /** 注销时间：self-deleting 进入冷静期的时间戳；owner 直接注销同样落这里（无冷静期）。 */
    deleted_at: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    /** 主页内容（Markdown），显示在公开主页上，按 homepage_visibility 控制可见。 */
    homepage_md: text('homepage_md').notNull().default(''),
    /** 遗留字段：已拆分为 following/followers/homepage 三个可见度，不再使用。 */
    social_visibility: varchar('social_visibility', { length: 16 }).notNull().default('public'),
    /**
     * 关注列表可见度：public 公开 / mutual 互关可见 / private 仅自己。
     */
    following_visibility: varchar('following_visibility', { length: 16 }).notNull().default('public'),
    /**
     * 粉丝列表可见度：public 公开 / mutual 互关可见 / private 仅自己。
     */
    followers_visibility: varchar('followers_visibility', { length: 16 }).notNull().default('public'),
    /**
     * 主页可见度：public 公开 / mutual 互关可见 / private 仅自己。
     */
    homepage_visibility: varchar('homepage_visibility', { length: 16 }).notNull().default('public'),
    /**
     * 主题偏好（按账号存，换设备/换浏览器登录也是同一套）：
     * - theme_colour: azure/pink/mint/orange/slate/none，NULL = 从未设置（默认 azure）
     * - theme_mode:   auto/dark/light，NULL = 从未设置（默认 auto 跟随系统）
     */
    theme_colour: varchar('theme_colour', { length: 16 }),
    theme_mode: varchar('theme_mode', { length: 8 }),
    /**
     * 是否允许被别人搜到（控制台 → 隐私设置，默认 true）。
     * 关掉后：导航栏搜索、用户搜索里都不出现；主页本身仍可通过链接直接访问。
     */
    searchable: boolean('searchable').notNull().default(true),
    created_at: createdAtColumn(),
    updated_at: updatedAtColumn(),
    last_seen_at: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    // Emails and usernames are matched case-insensitively without citext.
    uniqueIndex('users_username_lower_unique').on(sql`lower(${table.username})`),
    uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`),
    index('users_state_idx').on(table.state),
    index('users_role_idx').on(table.role),
    index('users_level_idx').on(table.level),
    index('users_created_at_idx').on(table.created_at),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** sha256 of the raw cookie value; the raw value is never stored. */
    token_hash: text('token_hash').notNull().unique(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ip: text('ip'),
    user_agent: text('user_agent'),
    created_at: createdAtColumn(),
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    last_used_at: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    revoked_at: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.user_id),
    // Partial index: only unrevoked, unexpired sessions are worth scanning.
    index('sessions_active_idx')
      .on(table.expires_at)
      .where(sql`${table.revoked_at} IS NULL`),
  ],
);

export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 'github' | 'google' — an adapter that can be extended without a migration. */
    provider: text('provider').notNull(),
    provider_account_id: text('provider_account_id').notNull(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    created_at: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('oauth_provider_account_unique').on(table.provider, table.provider_account_id),
    // One link per provider per user.
    uniqueIndex('oauth_user_provider_unique').on(table.user_id, table.provider),
  ],
);

export const emailTokens = pgTable(
  'email_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** verify_email | reset_password | change_email */
    purpose: text('purpose').notNull(),
    token_hash: text('token_hash').notNull().unique(),
    /** Target address for change_email, NULL otherwise. */
    new_email: text('new_email'),
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    used_at: timestamp('used_at', { withTimezone: true, mode: 'date' }),
    created_at: createdAtColumn(),
  },
  (table) => [index('email_tokens_user_id_idx').on(table.user_id)],
);

export const inviteCodes = pgTable(
  'invite_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The human-shareable code phrase. */
    code: text('code').notNull().unique(),
    created_by: uuid('created_by')
      .notNull()
      .references(() => users.id),
    note: text('note'),
    /** NULL = unlimited. */
    max_uses: integer('max_uses'),
    used_count: integer('used_count').notNull().default(0),
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    revoked_at: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    created_at: createdAtColumn(),
  },
  (table) => [index('invite_codes_created_by_idx').on(table.created_by)],
);

export const inviteCodeUses = pgTable(
  'invite_code_uses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invite_code_id: uuid('invite_code_id')
      .notNull()
      .references(() => inviteCodes.id, { onDelete: 'cascade' }),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    used_at: createdAtColumn('used_at'),
  },
  (table) => [uniqueIndex('invite_use_unique').on(table.invite_code_id, table.user_id)],
);

/** 关注关系：follower 关注 following。禁止自己关注自己（服务层校验）。 */
export const follows = pgTable(
  'follows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    follower_id: uuid('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    following_id: uuid('following_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    created_at: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('follows_pair_unique').on(table.follower_id, table.following_id),
    index('follows_following_idx').on(table.following_id),
    index('follows_follower_idx').on(table.follower_id),
  ],
);