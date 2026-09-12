import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as pgliteDrizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle as nodeDrizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { getEnv } from '@ycomm/kernel';
import * as schema from './schema/index';
import { runMigrationsOn } from './migrate';

/**
 * Driver-agnostic database type.
 *
 * Both `PgliteDatabase` and `NodePgDatabase` are `PgDatabase` instances and the
 * query surface is identical; union-calling them would produce incompatible
 * signatures, so the shared type collapses the query-result generic. The
 * concrete instances stay private — nothing outside this package knows or cares
 * which driver is running.
 */
export type Db = PgDatabase<any, typeof schema>;

export interface DatabaseHandle {
  db: Db;
  /**
   * Apply pending migrations (idempotent).
   *
   * Only meaningful for scripts and the container entrypoint — the web app never
   * runs migrations. Consequently the migrations folder must be passed in by
   * the caller (CLIs resolve it from their own location, which keeps it out of
   * the server bundle).
   */
  runMigrations(): Promise<void>;
  close(): Promise<void>;
}

export interface DatabaseOptions {
  /** Absolute path to the generated SQL migrations folder. */
  migrationsFolder?: string;
}

function noMigrationsFolder(): never {
  throw new Error(
    'runMigrations() requires the migrationsFolder option. ' +
      'The web app never migrates; use the db:migrate CLI or docker entrypoint instead.',
  );
}

function requireMigrationsFolder(options: DatabaseOptions): string {
  if (!options.migrationsFolder) {
    noMigrationsFolder();
  }
  return options.migrationsFolder;
}

/**
 * Create a database handle for the configured driver.
 *
 * - `pglite`  — embedded Postgres in a data directory (local dev, zero install).
 * - `postgres` — a connection pool against a real Postgres (production).
 *
 * The same schema and the same migration files are used in both cases.
 *
 * NOTE (PGlite dev quirk): a PGlite data directory supports exactly ONE live
 * process. Never let two node processes (dev server + any CLI or a second dev
 * server) touch the same PGLITE_DATA_DIR, and never hard-kill a dev server
 * while it is writing — both corrupt the directory so that the next open
 * aborts. If it happens: delete the directory and rebuild (db:migrate →
 * db:seed → owner:create).
 */
export async function createDb(options: DatabaseOptions = {}): Promise<DatabaseHandle> {
  const env = getEnv();

  if (env.DATABASE_DRIVER === 'pglite') {
    // PGlite does not create parent directories itself.
    mkdirSync(env.PGLITE_DATA_DIR, { recursive: true });
    const instance = new PGlite(env.PGLITE_DATA_DIR);
    const driverDb: PgliteDatabase<typeof schema> = pgliteDrizzle(instance, { schema });
    // Folder is validated lazily: the web app creates handles without a folder
    // and never calls runMigrations, so it must not throw at creation time.
    return {
      db: driverDb as unknown as Db,
      runMigrations: () => runMigrationsOn(driverDb, 'pglite', requireMigrationsFolder(options)),
      close: () => instance.close(),
    };
  }

  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when DATABASE_DRIVER=postgres');
  }
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
  const driverDb: NodePgDatabase<typeof schema> = nodeDrizzle(pool, { schema });
  return {
    db: driverDb as unknown as Db,
    runMigrations: () => runMigrationsOn(driverDb, 'postgres', requireMigrationsFolder(options)),
    close: () => pool.end(),
  };
}

/**
 * In-memory database for tests. Never touches the configured driver; this is
 * what keeps unit and integration tests hermetic and dependency-free.
 */
export async function createInMemoryDb(options: DatabaseOptions = {}): Promise<DatabaseHandle> {
  const instance = new PGlite();
  const driverDb: PgliteDatabase<typeof schema> = pgliteDrizzle(instance, { schema });
  const migrationsFolder = requireMigrationsFolder(options);
  return {
    db: driverDb as unknown as Db,
    runMigrations: () => runMigrationsOn(driverDb, 'pglite', migrationsFolder),
    close: () => instance.close(),
  };
}

const GLOBAL_HANDLE_KEY = '__ycomm_db_handle__';

/**
 * Process-wide singleton for application code (NOT for tests — use `createInMemoryDb`).
 *
 * The promise lives on `globalThis`, NOT on a module variable: Next.js bundles
 * server components and route handlers separately, which would otherwise give
 * each bundle its own module instance — and with PGlite (a data directory that
 * supports exactly one live opener) two instances in one process corrupt the
 * database and abort the WASM runtime. The global slot forces one handle per
 * process no matter how many times `getDb` is separately bundled.
 */
export function getDb(): Promise<DatabaseHandle> {
  const globalStore = globalThis as unknown as Record<string, unknown>;
  const existing = globalStore[GLOBAL_HANDLE_KEY];
  if (existing instanceof Promise) return existing as Promise<DatabaseHandle>;
  const handle = createDb();
  globalStore[GLOBAL_HANDLE_KEY] = handle;
  return handle;
}

export { runMigrationsOn } from './migrate';

export * as schema from './schema/index';
export * from './seed';