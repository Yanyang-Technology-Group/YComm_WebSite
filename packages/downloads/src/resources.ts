import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import { canViewResource, type AccessSubject } from '@ycomm/access';
import { DOWNLOAD_AREA, parseAccessPolicy, safeParseAccessPolicy, type AccessPolicy } from '@ycomm/config';
import { enqueueForReview } from '@ycomm/moderation';
import type { AssignableRole } from '@ycomm/config';

export type ResourceRow = typeof schema.downloadResources.$inferSelect;
export type ResourceStatus = ResourceRow['status'];

export interface CreateResourceInput {
  categoryId: string;
  authorId: string;
  authorRole: AssignableRole;
  title: string;
  summary?: string;
  descriptionMd?: string;
  versionLabel?: string;
  sourceType: 'external' | 'local';
  policy?: AccessPolicy;
}

export interface ResourceView extends ResourceRow {
  policy: AccessPolicy;
}

export async function createResource(db: Db, input: CreateResourceInput): Promise<ResourceView> {
  const title = input.title.trim();
  if (title.length < DOWNLOAD_AREA.minTitleLength || title.length > DOWNLOAD_AREA.maxTitleLength) {
    throw errors.validation({ issues: [{ path: 'title', message: `标题长度为 ${DOWNLOAD_AREA.minTitleLength}-${DOWNLOAD_AREA.maxTitleLength}` }] });
  }

  // Design rule: owners self-publish, admins need the owner's review.
  const status: ResourceStatus = input.authorRole === 'owner' ? 'published' : 'pending_review';
  const policy = input.policy ?? parseAccessPolicy({ visibility: 'login' });

  const [created] = await db
    .insert(schema.downloadResources)
    .values({
      category_id: input.categoryId,
      author_id: input.authorId,
      title,
      slug: randomUUID(),
      summary: input.summary ?? '',
      description_md: input.descriptionMd ?? '',
      version_label: input.versionLabel ?? null,
      source_type: input.sourceType,
      status,
      access_policy: policy,
      published_at: status === 'published' ? new Date() : null,
    })
    .returning();
  if (!created) throw errors.internal(undefined, 'resource insert failed');

  if (status === 'pending_review') {
    await enqueueForReview(db, {
      targetType: 'download_resource',
      targetId: created.id,
      reason: 'admin_upload_review',
    });
  }

  return { ...created, policy };
}

export async function getResourceRow(db: Db, resourceId: string): Promise<ResourceRow | null> {
  const rows = await db.select().from(schema.downloadResources).where(eq(schema.downloadResources.id, resourceId)).limit(1);
  return rows[0] ?? null;
}

export async function getResource(db: Db, resourceId: string): Promise<ResourceView | null> {
  const row = await getResourceRow(db, resourceId);
  if (!row) return null;
  return { ...row, policy: safeParseAccessPolicy(row.access_policy) };
}

export interface ResourceListOptions {
  categoryId?: string;
  offset?: number;
  limit?: number;
}

/** Published resources the subject may see (honoring each resource's policy). */
export async function listPublishedResources(
  db: Db,
  subject: AccessSubject | null,
  options: ResourceListOptions = {},
): Promise<{ resources: ResourceView[]; total: number }> {
  const limit = Math.min(options.limit ?? 20, 100);
  const where = and(
    eq(schema.downloadResources.status, 'published'),
    isNull(schema.downloadResources.deleted_at),
    options.categoryId ? eq(schema.downloadResources.category_id, options.categoryId) : undefined,
  );

  const rows = await db
    .select()
    .from(schema.downloadResources)
    .where(where)
    .orderBy(desc(schema.downloadResources.published_at))
    .limit(limit)
    .offset(options.offset ?? 0);

  const resources: ResourceView[] = [];
  for (const row of rows) {
    const policy = safeParseAccessPolicy(row.access_policy);
    if (await canViewResource(db, subject, { type: 'download_resource', id: row.id, policy })) {
      resources.push({ ...row, policy });
    }
  }

  const totals = await db.select({ n: sql<number>`count(*)::int` }).from(schema.downloadResources).where(where);
  return { resources, total: totals[0]?.n ?? 0 };
}

/** Staff listing across statuses (admin review pages, owner audit flow). */
export async function listAllResources(
  db: Db,
  options: { status?: ResourceStatus; offset?: number; limit?: number } = {},
): Promise<{ resources: ResourceRow[]; total: number }> {
  const limit = Math.min(options.limit ?? 50, 200);
  const where = options.status ? eq(schema.downloadResources.status, options.status) : undefined;
  const rows = await db
    .select()
    .from(schema.downloadResources)
    .where(where)
    .orderBy(desc(schema.downloadResources.created_at))
    .limit(limit)
    .offset(options.offset ?? 0);
  const totals = await db.select({ n: sql<number>`count(*)::int` }).from(schema.downloadResources).where(where);
  return { resources: rows, total: totals[0]?.n ?? 0 };
}

export interface UpdateResourceInput {
  title?: string;
  summary?: string;
  descriptionMd?: string;
  versionLabel?: string | null;
  categoryId?: string;
  policy?: AccessPolicy;
}

/**
 * Metadata edits only — publishing state stays untouched. Edits that change the
 * FILE or LINKS go through `requestReReview`, because only the owner decides
 * what content ships.
 */
export async function updateResourceMetadata(
  db: Db,
  resourceId: string,
  patch: UpdateResourceInput,
): Promise<ResourceRow> {
  const current = await getResourceRow(db, resourceId);
  if (!current) throw errors.notFound('资源不存在');

  const title = patch.title?.trim(); 
  if (title !== undefined && (title.length < DOWNLOAD_AREA.minTitleLength || title.length > DOWNLOAD_AREA.maxTitleLength)) {
    throw errors.validation({ issues: [{ path: 'title', message: `标题长度为 ${DOWNLOAD_AREA.minTitleLength}-${DOWNLOAD_AREA.maxTitleLength}` }] });
  }

  const [updated] = await db
    .update(schema.downloadResources)
    .set({
      ...(title !== undefined ? { title } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      ...(patch.descriptionMd !== undefined ? { description_md: patch.descriptionMd } : {}),
      ...(patch.versionLabel !== undefined ? { version_label: patch.versionLabel } : {}),
      ...(patch.categoryId !== undefined ? { category_id: patch.categoryId } : {}),
      ...(patch.policy !== undefined ? { access_policy: patch.policy } : {}),
      updated_at: new Date(),
    })
    .where(eq(schema.downloadResources.id, resourceId))
    .returning();
  if (!updated) throw errors.internal(undefined, 'resource update failed');
  return updated;
}

/**
 * A published resource whose FILE or LINKS changed must go back through the
 * owner's review — unless the resource is the owner's own: there is no higher
 * authority to review it, so it stays published. Called by the links service
 * when links change and by the upload route when a local file is replaced.
 */
export async function requestReReview(db: Db, resourceId: string): Promise<void> {
  const current = await getResourceRow(db, resourceId);
  if (!current) throw errors.notFound('资源不存在');
  if (current.status !== 'published') return; // drafts and pending items don't re-round-trip

  const authors = await db
    .select({ role: schema.users.role })
    .from(schema.downloadResources)
    .innerJoin(schema.users, eq(schema.downloadResources.author_id, schema.users.id))
    .where(eq(schema.downloadResources.id, resourceId))
    .limit(1);
  if (authors[0]?.role === 'owner') {
    // 站长的资源直接生效，无更高权限者需要审批。
    return;
  }

  await db
    .update(schema.downloadResources)
    .set({ status: 'pending_review', updated_at: new Date() })
    .where(eq(schema.downloadResources.id, resourceId));
  await enqueueForReview(db, {
    targetType: 'download_resource',
    targetId: resourceId,
    reason: 'admin_upload_review',
  });
}

/** Author withdraws a pending submission back to draft. */
export async function withdrawResource(db: Db, resourceId: string): Promise<void> {
  const current = await getResourceRow(db, resourceId);
  if (!current) throw errors.notFound('资源不存在');
  if (current.status !== 'pending_review') {
    throw errors.forbidden('只有待审核的资源可以撤回');
  }
  await db
    .update(schema.downloadResources)
    .set({ status: 'draft', updated_at: new Date() })
    .where(eq(schema.downloadResources.id, resourceId));
}

export async function archiveResource(db: Db, resourceId: string): Promise<void> {
  await db
    .update(schema.downloadResources)
    .set({ status: 'archived', updated_at: new Date() })
    .where(eq(schema.downloadResources.id, resourceId));
}

export async function softDeleteResource(db: Db, resourceId: string, byId: string): Promise<void> {
  await db
    .update(schema.downloadResources)
    .set({ deleted_at: new Date(), updated_at: new Date() })
    .where(eq(schema.downloadResources.id, resourceId));
  void byId;
}