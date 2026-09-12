/**
 * `@ycomm/db` — the only package that knows how to talk to the database.
 *
 * The schema, migrations, seeds and the driver-agnostic client live here. Domain
 * packages go through `getDb()`/`createDb()` and never import `pg`/`pglite`
 * themselves, which keeps the driver swappable and the credentials contained.
 */
export {
  createDb,
  createInMemoryDb,
  getDb,
  runMigrationsOn,
  type DatabaseHandle,
  type Db,
} from './client';

export * as schema from './schema/index';
export * from './seed';
export { getSetting, setSetting } from './settings';