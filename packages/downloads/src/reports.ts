import { desc, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import { DOWNLOAD_AREA } from '@ycomm/config';
import { enqueueForReview } from '@ycomm/moderation';

async function applyReport(db: Db, link: { id: string; resource_id: string; status: string }, input: { reporterId: string; reason?: string }): Promise<void> {
  await db.insert(schema.downloadReports).values({
    resource_id: link.resource_id,
    link_id: link.id,
    reporter_id: input.reporterId,
    reason: input.reason ?? 'dead',
  });

  const [updated] = await db
    .update(schema.downloadLinks)
    .set({ reported_dead_count: sql`${schema.downloadLinks.reported_dead_count} + 1` })
    .where(eq(schema.downloadLinks.id, link.id))
    .returning({ reported_dead_count: schema.downloadLinks.reported_dead_count });

  if ((updated?.reported_dead_count ?? 0) >= DOWNLOAD_AREA.linkReportThreshold) {
    await db.update(schema.downloadLinks).set({ status: 'under_review' }).where(eq(schema.downloadLinks.id, link.id));
    await enqueueForReview(db, {
      targetType: 'download_link',
      targetId: link.id,
      reason: 'dead_link_review',
      reporterId: input.reporterId,
      detail: `链接累计 ${updated?.reported_dead_count} 次举报`,
    });
  }
}

/**
 * Report a dead/mirror link. Once the threshold is reached the link is flagged
 * `under_review` and a moderation item is queued (decider: approve → dead,
 * reject → keep active).
 */
export async function reportDeadLink(
  db: Db,
  input: { linkId: string; reporterId: string; reason?: string },
): Promise<void> {
  const rows = await db
    .select({ id: schema.downloadLinks.id, resource_id: schema.downloadLinks.resource_id, status: schema.downloadLinks.status })
    .from(schema.downloadLinks)
    .where(eq(schema.downloadLinks.id, input.linkId))
    .limit(1);
  const link = rows[0];
  if (!link) throw errors.notFound('链接不存在');
  if (link.status !== 'active') throw errors.forbidden('该链接无需举报');
  await applyReport(db, link, input);
}

/**
 * Resource-level dead-link report: targets the first active link of the
 * resource (the UI never exposes link ids).
 */
export async function reportDeadLinkByResource(
  db: Db,
  input: { resourceId: string; reporterId: string; reason?: string },
): Promise<void> {
  const links = await db
    .select({ id: schema.downloadLinks.id, resource_id: schema.downloadLinks.resource_id, status: schema.downloadLinks.status })
    .from(schema.downloadLinks)
    .where(eq(schema.downloadLinks.resource_id, input.resourceId))
    .orderBy(desc(schema.downloadLinks.kind))
    .limit(10);
  const active = links.find((link) => link.status === 'active');
  if (!active) throw errors.notFound('该资源没有可举报的下载链接');
  await applyReport(db, active, input);
}