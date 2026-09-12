import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn } from './helpers';
import { users } from './identity';

/**
 * Runtime settings overriding `config/*` defaults. Values are stored as `jsonb`
 * and validated against the feature schema on read; a row that fails validation
 * falls back to the code default rather than crashing the site.
 */
export const settings = pgTable(
  'settings',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').notNull(),
    updated_by: uuid('updated_by').references(() => users.id),
    updated_at: timestamp('updated_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [index('settings_updated_idx').on(table.updated_at)],
);

/** Append-only record of administrative actions and failed sign-ins. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actor_id: uuid('actor_id').references(() => users.id),
    actor_ip: text('actor_ip'),
    action: text('action').notNull(),
    target_type: text('target_type'),
    target_id: uuid('target_id'),
    /** Arbitrary structured detail; never contains secrets (redacted at write time). */
    meta: jsonb('meta').notNull().default({}),
    created_at: createdAtColumn(),
  },
  (table) => [
    index('audit_logs_actor_time_idx').on(table.actor_id, table.created_at),
    index('audit_logs_target_idx').on(table.target_type, table.target_id),
  ],
);

/**
 * Database-backed job queue. Deliberately no Redis: at this deployment scale a
 * table plus a polling worker in the same process is fewer moving parts, and
 * the row-per-job shape keeps a paper trail of every attempt.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    max_attempts: integer('max_attempts').notNull().default(5),
    run_at: timestamp('run_at', { withTimezone: true, mode: 'date' }).notNull(),
    locked_at: timestamp('locked_at', { withTimezone: true, mode: 'date' }),
    locked_by: text('locked_by'),
    last_error: text('last_error'),
    created_at: createdAtColumn(),
    finished_at: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [index('jobs_pending_idx').on(table.status, table.run_at)],
);