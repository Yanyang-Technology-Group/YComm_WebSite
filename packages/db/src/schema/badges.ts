import { index, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn } from './helpers';
import { users } from './identity';

/**
 * 徽章系统（多徽章）：
 * - badges          徽章定义，管理员创建，包含显示文字和渐变色（可视化编辑器）；
 * - user_badges     用户挂载的徽章（多对多，一个用户可挂多个），管理员分配。
 */
export const badges = pgTable('badges', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 徽章上显示的文字（例如「元老」「大善人」）。 */
  name: text('name').notNull(),
  /** 渐变起点色（#rrggbb）。 */
  color_from: text('color_from').notNull().default('#ff9a3c'),
  /** 渐变终点色（#rrggbb）。 */
  color_to: text('color_to').notNull().default('#e0522f'),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: createdAtColumn(),
});

export const userBadges = pgTable(
  'user_badges',
  {
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    badge_id: uuid('badge_id')
      .notNull()
      .references(() => badges.id, { onDelete: 'cascade' }),
    assigned_by: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: createdAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.user_id, table.badge_id] }),
    index('user_badges_badge_idx').on(table.badge_id),
  ],
);