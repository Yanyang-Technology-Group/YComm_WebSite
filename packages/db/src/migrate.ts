import { migrate } from 'drizzle-orm/pglite/migrator';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';

/**
 * Apply pending SQL migrations, idempotent.
 *
 * `db` is the concrete (driver-typed) drizzle instance — the pglite and
 * node-postgres migrators have incompatible signatures, which is why this
 * function's parameter is untyped and lives here rather than in `client.ts`.
 */
export async function runMigrationsOn(
  db: unknown,
  driver: 'pglite' | 'postgres',
  migrationsFolder: string,
): Promise<void> {
  if (driver === 'pglite') {
    await migrate(db as never, { migrationsFolder });
  } else {
    await migrateNodePg(db as never, { migrationsFolder });
  }
}