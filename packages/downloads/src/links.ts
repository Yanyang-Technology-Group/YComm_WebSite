import { asc, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import { DOWNLOAD_AREA, isExternalHostAllowed } from '@ycomm/config';
import { requestReReview } from './resources';

export type LinkRow = typeof schema.downloadLinks.$inferSelect;

export interface AddLinkInput {
  resourceId: string;
  kind?: 'primary' | 'mirror';
  sourceType: 'external' | 'local';
  /** Required for external links. Must be allow-listed (config/downloads.ts). */
  url?: string;
  /** 网盘提取码 — gated like the URL itself. */
  extractCode?: string;
  /** Required for local links. */
  localPath?: string;
  fileName?: string;
  sizeBytes?: number;
  checksumSha256?: string;
}

/**
 * Add a link to a resource. External URLs are allow-listed per host — the
 * download area is a natural phishing/spam vector.
 */
export async function addLink(db: Db, input: AddLinkInput): Promise<LinkRow> {
  if (input.sourceType === 'external') {
    if (!input.url) {
      throw errors.validation({ issues: [{ path: 'url', message: '外链必须提供 url' }] });
    }
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      throw errors.validation({ issues: [{ path: 'url', message: 'url 格式不正确' }] });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw errors.validation({ issues: [{ path: 'url', message: '仅支持 http/https' }] });
    }
    if (!isExternalHostAllowed(parsed.hostname)) {
      throw errors.validation({ issues: [{ path: 'url', message: '外链域名不在允许列表内' }] });
    }
  } else {
    if (!input.localPath) {
      throw errors.validation({ issues: [{ path: 'localPath', message: '本地链接必须提供 localPath' }] });
    }
  }

  const count = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.downloadLinks)
    .where(eq(schema.downloadLinks.resource_id, input.resourceId));
  if ((count[0]?.n ?? 0) >= DOWNLOAD_AREA.maxLinksPerResource) {
    throw errors.validation({ issues: [{ path: 'links', message: `每个资源最多 ${DOWNLOAD_AREA.maxLinksPerResource} 个链接` }] });
  }

  const [created] = await db
    .insert(schema.downloadLinks)
    .values({
      resource_id: input.resourceId,
      kind: input.kind ?? 'primary',
      source_type: input.sourceType,
      url: input.url ?? null,
      extract_code: input.extractCode ?? null,
      local_path: input.localPath ?? null,
      file_name: input.fileName ?? null,
      size_bytes: input.sizeBytes ?? null,
      checksum_sha256: input.checksumSha256 ?? null,
    })
    .returning();
  if (!created) throw errors.internal(undefined, 'link insert failed');

  // Changing links on a published admin resource re-opens owner review.
  await requestReReview(db, input.resourceId);
  return created;
}

export async function removeLink(db: Db, linkId: string): Promise<void> {
  const rows = await db.select({ resource_id: schema.downloadLinks.resource_id }).from(schema.downloadLinks).where(eq(schema.downloadLinks.id, linkId)).limit(1);
  const resourceId = rows[0]?.resource_id;
  if (!resourceId) throw errors.notFound('链接不存在');

  await db.delete(schema.downloadLinks).where(eq(schema.downloadLinks.id, linkId));
  await requestReReview(db, resourceId);
}

export async function getLinkRow(db: Db, linkId: string): Promise<LinkRow | null> {
  const rows = await db.select().from(schema.downloadLinks).where(eq(schema.downloadLinks.id, linkId)).limit(1);
  return rows[0] ?? null;
}

/** The resource a link belongs to — used for author checks at the API layer. */
export async function getResourceIdByLink(db: Db, linkId: string): Promise<string | null> {
  const row = await getLinkRow(db, linkId);
  return row?.resource_id ?? null;
}

/**
 * The ONLY place external URLs are read for serving. Never exposed through
 * listing/detail APIs; the fetch gate hands the outcome to a redirect.
 */
export async function getActiveLinks(db: Db, resourceId: string): Promise<LinkRow[]> {
  return db
    .select()
    .from(schema.downloadLinks)
    .where(eq(schema.downloadLinks.resource_id, resourceId))
    .orderBy(asc(schema.downloadLinks.kind), asc(schema.downloadLinks.sort_order));
}