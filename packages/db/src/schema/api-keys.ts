import { index, pgTable, text, timestamp, uuid, boolean } from 'drizzle-orm/pg-core';
import { createdAtColumn } from './helpers';
import { users } from './identity';

/**
 * 开放 API 的密钥（**仅站长 owner 可创建/使用**）。
 *
 * - 明文只在创建时返回一次，库里只存 sha256（`key_hash`）；
 * - `prefix` 用于后台列表里辨认是哪个 key（不足以还原密钥）；
 * - 撤销 = `revoked_at`；过期 = `expires_at`；`last_used_at` 记录最近使用时间。
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 名称（展示用，例如「CI 自动建卡」）。 */
    name: text('name').notNull(),
    /** 明文前缀，例如 `ycomm_ab12cd34`，后台列表展示。 */
    prefix: text('prefix').notNull(),
    /** sha256(明文)。 */
    key_hash: text('key_hash').notNull().unique(),
    /** 归属用户（必须是 owner；owner 转让后其 key 立即失效）。 */
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 是否只读（只允许 GET 类接口）。 */
    read_only: boolean('read_only').notNull().default(false),
    last_used_at: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    revoked_at: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    created_at: createdAtColumn(),
  },
  (table) => [index('api_keys_user_idx').on(table.user_id, table.revoked_at)],
);
