import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the migrations folder from THIS module's location.
 *
 * Lives in the CLI layer on purpose: code imported by the server bundle must
 * never reference the migrations directory (Turbopack statically analyzes
 * `new URL(...)` references and fails), and the server never migrates anyway.
 */
export function resolveMigrationsFolderFromCli(): string {
  // src/cli/migrate.ts -> packages/db/migrations
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
}