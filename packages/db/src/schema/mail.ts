import { index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, updatedAtColumn } from './helpers';
import { users } from './identity';

/** Credentials stay outside generic settings and are encrypted by notify. */
export const mailConfiguration = pgTable('mail_configuration', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  from_address: text('from_address').notNull(),
  smtp_host: text('smtp_host'),
  smtp_port: integer('smtp_port'),
  smtp_security: text('smtp_security'),
  smtp_user: text('smtp_user'),
  encrypted_secret: text('encrypted_secret'),
  updated_by: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updated_at: updatedAtColumn(),
});

/** Reusable body only; the two background shells remain code-owned. */
export const mailBodyTemplates = pgTable('mail_body_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  body_html: text('body_html').notNull(),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: createdAtColumn(),
  updated_at: updatedAtColumn(),
});

/** Content is immutable after submission; approval queues its exact snapshot. */
export const mailCampaigns = pgTable('mail_campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  subject: text('subject').notNull(),
  subtitle: text('subtitle').notNull().default(''),
  background: text('background').notNull(),
  body_html: text('body_html').notNull(),
  recipients: jsonb('recipients').$type<string[]>().notNull(),
  status: text('status').notNull().default('pending'),
  reviewed_by: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  review_note: text('review_note'),
  reviewed_at: updatedAtColumn('reviewed_at'),
  created_at: createdAtColumn(),
}, (table) => [index('mail_campaigns_status_idx').on(table.status, table.created_at)]);

export const mailDeliveries = pgTable('mail_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  campaign_id: uuid('campaign_id').notNull().references(() => mailCampaigns.id, { onDelete: 'cascade' }),
  to_email: text('to_email').notNull(),
  status: text('status').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  sent_at: updatedAtColumn('sent_at'),
  created_at: createdAtColumn(),
}, (table) => [index('mail_deliveries_campaign_idx').on(table.campaign_id)]);
