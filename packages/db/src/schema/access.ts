import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, updatedAtColumn } from './helpers';
import { users } from './identity';
import type { AccessPolicy } from '@ycomm/config';

/**
 * Proof that a user may access a specific restricted resource.
 *
 * One row per (user, resource). `resource_type` is polymorphic on purpose —
 * boards, download categories and download resources all use it, which is what
 * lets a single invite mechanism guard both "this board needs an invite" and
 * "this download needs an invite" without any per-module duplication.
 */
export const accessGrants = pgTable(
  'access_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** board | download_category | download_resource */
    resource_type: text('resource_type').notNull(),
    resource_id: uuid('resource_id').notNull(),
    /** invite_code | admin | purchase */
    granted_via: text('granted_via').notNull(),
    granted_by: uuid('granted_by').references(() => users.id),
    expires_at: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    created_at: createdAtColumn(),
    updated_at: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex('access_grant_unique').on(table.user_id, table.resource_type, table.resource_id),
    index('access_grant_resource_idx').on(table.resource_type, table.resource_id),
  ],
);

/**
 * Access policies live as validated `jsonb` on the resources themselves.
 * The column type is enforced by zod at the boundary (`config/access-policy.ts`),
 * never trusted straight out of the database.
 */
export const accessPolicyJsonb = {
  access_policy: jsonb('access_policy').$type<AccessPolicy>().notNull(),
} as const;