import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { assertCanViewResource, assertPermission, assertSubjectCanAct, type AccessSubject } from '@ycomm/access';
import { PERMISSION, RATE_LIMITS, safeParseAccessPolicy } from '@ycomm/config';
import { AppError, ErrorCodes, errors } from '@ycomm/kernel';
import { getActiveLinks } from './links';

export type DownloadResource = typeof schema.downloadResources.$inferSelect;

export type DownloadOutcome =
  | { kind: 'external'; url: string; extractCode: string | null }
  | { kind: 'local'; localPath: string; fileName: string; sizeBytes: number | null };

async function loadPublishedResource(db: Db, resourceId: string): Promise<DownloadResource> {
  const rows = await db.select().from(schema.downloadResources).where(eq(schema.downloadResources.id, resourceId)).limit(1);
  const resource = rows[0];
  if (!resource || resource.deleted_at !== null) {
    throw errors.notFound('资源不存在');
  }
  if (resource.status !== 'published') {
    throw new AppError({
      code: ErrorCodes.RESOURCE_NOT_PUBLISHED,
      httpStatus: 403,
      message: '资源尚未发布',
      expose: true,
    });
  }
  return resource;
}

/** Step ① account state → ② resource policy → ③ permission, for the fetch/extract paths. */
async function gateFetch(db: Db, subject: AccessSubject | null, resource: DownloadResource): Promise<void> {
  if (subject) {
    assertSubjectCanAct(subject);
    await assertCanViewResource(db, subject, {
      type: 'download_resource',
      id: resource.id,
      policy: safeParseAccessPolicy(resource.access_policy),
    });
    assertPermission(subject, PERMISSION.DOWNLOAD_FILE_FETCH);
    return;
  }

  // Guests may only reach PUBLIC resources — everything else is a login wall.
  const policy = safeParseAccessPolicy(resource.access_policy);
  if (policy.visibility !== 'public') {
    throw errors.loginRequired();
  }
  await assertCanViewResource(db, null, { type: 'download_resource', id: resource.id, policy });
}

/**
 * The download gate — the one path that may read link URLs.
 *
 * Order is fixed and every step is explainable:
 *   resource published → ① account state → ② resource policy → ③ permission
 *   `download.file.fetch` → ④ daily quota (SQL, survives restarts) → log.
 *
 * The API layer answers with a redirect (external) or a streamed file (local);
 * neither the URL nor the extract code ever appears in a listing/detail payload.
 */
export async function authorizedFetch(
  db: Db,
  subject: AccessSubject | null,
  resourceId: string,
  meta: { ip: string; userAgent?: string },
): Promise<DownloadOutcome> {
  const resource = await loadPublishedResource(db, resourceId);
  await gateFetch(db, subject, resource);

  // ④ daily quota — members by id, guests by IP (both survive restarts since
  // they are counted from the log table).
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const [counts] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.downloadLogs)
    .where(
      subject
        ? and(eq(schema.downloadLogs.user_id, subject.id), gte(schema.downloadLogs.created_at, dayStart))
        : and(
            isNull(schema.downloadLogs.user_id),
            eq(schema.downloadLogs.ip, meta.ip || 'unknown'),
            gte(schema.downloadLogs.created_at, dayStart),
          ),
    );

  const dailyLimit = RATE_LIMITS.downloadDaily.limit;
  if ((counts?.n ?? 0) >= dailyLimit) {
    throw errors.rateLimited({ rule: 'downloadDaily', quota: dailyLimit });
  }

  const links = await getActiveLinks(db, resourceId);
  const link = links[0];
  if (!link || link.status !== 'active') {
    throw errors.notFound('没有可用的下载链接');
  }

  const outcome: DownloadOutcome =
    link.source_type === 'external'
      ? { kind: 'external', url: link.url ?? '', extractCode: link.extract_code }
      : {
          kind: 'local',
          localPath: link.local_path ?? '',
          fileName: link.file_name ?? `download-${resource.title}`,
          sizeBytes: link.size_bytes ?? null,
        };

  await db.insert(schema.downloadLogs).values({
    resource_id: resourceId,
    link_id: link.id,
    user_id: subject ? subject.id : null,
    ip: meta.ip ?? null,
    user_agent: meta.userAgent ?? null,
  });
  await db
    .update(schema.downloadResources)
    .set({ download_count: sql`${schema.downloadResources.download_count} + 1` })
    .where(eq(schema.downloadResources.id, resourceId));

  return outcome;
}

/**
 * Extract-code reveal — same gate, no download counted. Returns the code of
 * the first active external link, or null when there is none.
 */
export async function authorizedExtractCode(
  db: Db,
  subject: AccessSubject | null,
  resourceId: string,
): Promise<string | null> {
  const resource = await loadPublishedResource(db, resourceId);
  await gateFetch(db, subject, resource);

  const links = await getActiveLinks(db, resourceId);
  const link = links.find((entry) => entry.source_type === 'external' && entry.status === 'active');
  return link?.extract_code ?? null;
}