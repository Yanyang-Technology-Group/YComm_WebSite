import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn } from './helpers';
import { users } from './identity';

/** In-app notifications. Email side effects are recorded in `emailLogs`. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** reply | mention | moderation | download_review | system */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    link_url: text('link_url'),
    read_at: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    created_at: createdAtColumn(),
  },
  (table) => [index('notifications_user_unread_idx').on(table.user_id, table.read_at)],
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