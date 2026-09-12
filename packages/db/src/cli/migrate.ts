import { createDb } from '../client';
import { resolveMigrationsFolderFromCli } from './migrations-path';

/** `npm run db:migrate` — apply pending migrations for the configured driver. */
const handle = await createDb({ migrationsFolder: resolveMigrationsFolderFromCli() });
try {
  await handle.runMigrations();
  console.log('Migrations applied OK');
} finally {
  await handle.close();
}