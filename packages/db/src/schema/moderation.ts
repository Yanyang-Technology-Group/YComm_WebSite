import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn } from './helpers';
import { users } from './identity';

export const modItemStatusEnum = pgEnum('moderation_item_status', ['pending', 'approved', 'rejected']);

/**
 * The unified review queue: new-member posts, user reports, admin-uploaded
 * resources and flagged links all land here, so the dashboard renders a single
 * "things to decide" list with one approve/reject implementation.
 */
export const moderationItems = pgTable(
  'moderation_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** topic | post | download_resource */
    target_type: text('target_type').notNull(),
    target_id: uuid('target_id').notNull(),
    /** new_user_review | reported | manual | admin_upload_review | dead_link_review */
    reason: text('reason').notNull(),
    reporter_id: uuid('reporter_id'),
    /** Free-text detail supplied with a report. */
    detail: text('detail'),
    status: modItemStatusEnum('status').notNull().default('pending'),
    decided_by: uuid('decided_by'),
    decided_at: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
    decision_note: text('decision_note'),
    created_at: createdAtColumn(),
  },
  (table) => [
    index('moderation_items_queue_idx').on(table.status, table.created_at),
    index('moderation_items_target_idx').on(table.target_type, table.target_id),
  ],
);

/** Append-only log of what a moderator actually did. */
export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    moderator_id: uuid('moderator_id').references(() => users.id),
    target_type: text('target_type'),
    target_id: uuid('target_id'),
    /** approve | reject | delete | warn | mute | ban | unban | pin | lock | unlock ... */
    action: text('action').notNull(),
    note: text('note'),
    created_at: createdAtColumn(),
  },
  (table) => [
    index('moderation_actions_moderator_idx').on(table.moderator_id),
    index('moderation_actions_target_idx').on(table.target_type, table.target_id),
  ],
);

export const userSanctions = pgTable(
  'user_sanctions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** warn | mute | ban */
    kind: text('kind').notNull(),
    reason: text('reason').notNull().default(''),
    issued_by: uuid('issued_by').references(() => users.id),
    starts_at: timestamp('starts_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** NULL = permanent (until revoked). */
    ends_at: timestamp('ends_at', { withTimezone: true, mode: 'date' }),
    revoked_at: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revoked_by: uuid('revoked_by'),
    created_at: createdAtColumn(),
  },
  (table) => [
    index('user_sanctions_user_idx').on(table.user_id, table.ends_at),
    index('user_sanctions_kind_idx').on(table.kind),
  ],
);