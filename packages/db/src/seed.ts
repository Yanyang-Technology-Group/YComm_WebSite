import { and, eq } from 'drizzle-orm';
import { BOARD_SEEDS, DOWNLOAD_CATEGORY_SEEDS, FEATURE_DEFAULTS } from '@ycomm/config';
import type { Db } from './client';
import { boards, downloadCategories, settings } from './schema/index';

/**
 * Idempotent bootstrap: seeds the boards, download categories and site settings
 * that ship with a fresh install. Existing rows are left untouched, so deleting
 * a seed from `config/` never deletes a database object.
 */
export async function seedDefaults(db: Db): Promise<void> {
  for (const seed of BOARD_SEEDS) {
    await db
      .insert(boards)
      .values({
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        parent_id: seed.parentSlug,
        sort_order: seed.sortOrder,
        access_policy: seed.accessPolicy,
      })
      .onConflictDoNothing({ target: boards.slug });
  }

  for (const seed of DOWNLOAD_CATEGORY_SEEDS) {
    await db
      .insert(downloadCategories)
      .values({
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        sort_order: seed.sortOrder,
        access_policy: seed.accessPolicy,
      })
      .onConflictDoNothing({ target: downloadCategories.slug });
  }

  // Feature switches: code defaults are the fallback; these rows are the overrides.
  for (const [key, value] of Object.entries(FEATURE_DEFAULTS)) {
    const existing = await db
      .select({ key: settings.key })
      .from(settings)
      .where(and(eq(settings.key, key)))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(settings).values({ key, value });
    }
  }
}