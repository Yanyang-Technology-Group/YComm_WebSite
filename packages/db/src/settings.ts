import { eq } from 'drizzle-orm';
import { settings } from './schema/system';
import type { Db } from './client';

/**
 * Read a runtime setting row. Values are jsonb; code defaults from `config/*`
 * remain the fallback — a row only exists when an operator changed something,
 * so a missing row is not an anomaly.
 */
export async function getSetting(db: Db, key: string): Promise<unknown | undefined> {
  const rows = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
  return rows[0]?.value;
}

/** Upsert a runtime setting row. */
export async function setSetting(
  db: Db,
  key: string,
  value: unknown,
  updatedBy?: string,
): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value, updated_by: updatedBy ?? null })
    .onConflictDoUpdate({ target: settings.key, set: { value, updated_by: updatedBy ?? null, updated_at: new Date() } });
}