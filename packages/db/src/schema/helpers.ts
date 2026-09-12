import { timestamp } from 'drizzle-orm/pg-core';

/** Not-null `created_at` with a database-side default. */
export function createdAtColumn(name = 'created_at') {
  return timestamp(name, { withTimezone: true, mode: 'date' }).notNull().defaultNow();
}

/** Nullable `updated_at`, maintained by application code (no triggers). */
export function updatedAtColumn(name = 'updated_at') {
  return timestamp(name, { withTimezone: true, mode: 'date' });
}

/** Nullable `deleted_at` used by soft deletes (content and users). */
export function deletedAtColumn(name = 'deleted_at') {
  return timestamp(name, { withTimezone: true, mode: 'date' });
}

/** Polymorphic target (board / topic / post / resource / user ...). */
export const polyTarget = {
  targetType: (name = 'target_type') => String(name),
} as const;