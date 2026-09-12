import { asc, eq, isNull } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { canViewResource, type AccessSubject } from '@ycomm/access';
import { errors } from '@ycomm/kernel';
import { parseAccessPolicy, safeParseAccessPolicy, type AccessPolicy } from '@ycomm/config';

export type CategoryRow = typeof schema.downloadCategories.$inferSelect;

export interface CategoryView extends CategoryRow {
  policy: AccessPolicy;
}

export async function listVisibleCategories(
  db: Db,
  subject: AccessSubject | null,
): Promise<CategoryView[]> {
  const rows = await db
    .select()
    .from(schema.downloadCategories)
    .where(isNull(schema.downloadCategories.archived_at))
    .orderBy(asc(schema.downloadCategories.sort_order));

  const visible: CategoryView[] = [];
  for (const row of rows) {
    const policy = safeParseAccessPolicy(row.access_policy);
    if (await canViewResource(db, subject, { type: 'download_category', id: row.id, policy })) {
      visible.push({ ...row, policy });
    }
  }
  return visible;
}

export async function getCategoryBySlug(db: Db, slug: string): Promise<CategoryView | null> {
  const rows = await db
    .select()
    .from(schema.downloadCategories)
    .where(eq(schema.downloadCategories.slug, slug))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, policy: safeParseAccessPolicy(row.access_policy) };
}

export async function createCategory(
  db: Db,
  input: { slug: string; name: string; description?: string; sortOrder?: number; policy?: AccessPolicy },
): Promise<CategoryRow> {
  if (!/^[a-z0-9-]{2,40}$/.test(input.slug)) {
    throw errors.validation({ issues: [{ path: 'slug', message: 'slug 仅限小写字母/数字/连字符' }] });
  }
  const [created] = await db
    .insert(schema.downloadCategories)
    .values({
      slug: input.slug,
      name: input.name.trim(),
      description: input.description ?? '',
      sort_order: input.sortOrder ?? 100,
      access_policy: input.policy ?? parseAccessPolicy({ visibility: 'login' }),
    })
    .returning();
  if (!created) throw errors.internal(undefined, 'category insert failed');
  return created;
}

export async function updateCategory(
  db: Db,
  categoryId: string,
  patch: { name?: string; description?: string; sortOrder?: number; policy?: AccessPolicy },
): Promise<CategoryRow> {
  const [updated] = await db
    .update(schema.downloadCategories)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.sortOrder !== undefined ? { sort_order: patch.sortOrder } : {}),
      ...(patch.policy !== undefined ? { access_policy: patch.policy } : {}),
      updated_at: new Date(),
    })
    .where(eq(schema.downloadCategories.id, categoryId))
    .returning();
  if (!updated) throw errors.notFound('分类不存在');
  return updated;
}