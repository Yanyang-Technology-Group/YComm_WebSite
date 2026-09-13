import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import { PERMISSION } from '@ycomm/config';
import { assertCanViewResource, assertPermission, assertSubjectCanAct } from '@ycomm/access';
import {
  addLink,
  authorizedExtractCode,
  authorizedFetch,
  createResource,
  getCategoryBySlug,
  getResource,
  getResourceIdByLink,
  listPublishedResources,
  listVisibleCategories,
  listCards,
  openLocalFile,
  removeLink,
  reportDeadLink,
  reportDeadLinkByResource,
  saveLocalFile,
  updateResourceMetadata,
  withdrawResource,
} from '@ycomm/downloads';
import { decide, listQueued } from '@ycomm/moderation';
import type { AppVariables } from '../context';
import { clientIp, sessionAuth } from '../middleware/session';
import { requirePermission } from '../middleware/permission';
import { rateLimitByUser } from '../middleware/rate-limit';
import { parseBody } from './forum';

const createResourceSchema = z.object({
  categorySlug: z.string().min(1),
  title: z.string().min(1).max(80),
  summary: z.string().max(300).optional(),
  description: z.string().max(20_000).optional(),
  versionLabel: z.string().max(40).optional(),
  sourceType: z.enum(['external', 'local']).default('external'),
  /** 管理员设置公开性：public=访客可下，login=仅会员，invite=需邀请码。 */
  visibility: z.enum(['public', 'login', 'invite']).default('login'),
});

const addLinkSchema = z.object({
  kind: z.enum(['primary', 'mirror']).optional(),
  sourceType: z.enum(['external', 'local']),
  url: z.string().optional(),
  extractCode: z.string().max(32).optional(),
  localPath: z.string().optional(),
  fileName: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});

const decideSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(500).optional(),
});

const reportSchema = z.object({ reason: z.string().max(300).optional() });

export function downloadsRoutes(): Hono<{ Variables: AppVariables }> {
  const router = new Hono<{ Variables: AppVariables }>();
  router.use('*', sessionAuth);

  router.get('/categories', async (c) => {
    const handle = await getDb();
    const categories = await listVisibleCategories(handle.db, c.get('auth')?.subject ?? null);
    return c.json({ ok: true, data: { categories } });
  });

  router.get('/cards', async (c) => {
    const handle = await getDb();
    const subject = c.get('auth')?.subject ?? null;
    const cards = await listCards(handle.db, subject);
    return c.json({
      ok: true,
      data: {
        cards: cards.map((card) => ({
          id: card.id,
          parentId: card.parent_id,
          title: card.title,
          subtitle: card.subtitle,
          kind: card.kind,
          redirectUrl: card.redirect_url,
          w: card.w,
          h: card.h,
          position: card.position,
        })),
      },
    });
  });

  router.get('/resources', async (c) => {
    const handle = await getDb();
    const subject = c.get('auth')?.subject ?? null;
    const result = await listPublishedResources(handle.db, subject, {
      categoryId: c.req.query('categoryId'),
      offset: Number.parseInt(c.req.query('offset') ?? '0', 10) || 0,
      limit: Math.min(Number.parseInt(c.req.query('limit') ?? '20', 10) || 20, 100),
    });
    return c.json({ ok: true, data: result });
  });

  router.get('/resources/:resourceId', async (c) => {
    const handle = await getDb();
    const subject = c.get('auth')?.subject ?? null;
    const resource = await getResource(handle.db, c.req.param('resourceId'));
    if (!resource) throw errors.notFound('资源不存在');
    assertSubjectCanAct(subject);
    await assertCanViewResource(handle.db, subject, { type: 'download_resource', id: resource.id, policy: resource.policy });
    assertPermission(subject, PERMISSION.DOWNLOAD_RESOURCE_VIEW);
    return c.json({ ok: true, data: { resource: publicResource(resource) } });
  });

  // ---- publishing (admin uploads, owner self-publish) -------------------
  router.post('/resources', requirePermission(PERMISSION.DOWNLOAD_RESOURCE_CREATE), async (c) => {
    const body = await parseBody(c, createResourceSchema);
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();

    const category = await getCategoryBySlug(handle.db, body.categorySlug);
    if (!category) throw errors.notFound('分类不存在');

    const { parseAccessPolicy } = await import('@ycomm/config');
    const resource = await createResource(handle.db, {
      categoryId: category.id,
      authorId: auth.userId,
      authorRole: auth.subject.role,
      title: body.title,
      summary: body.summary,
      descriptionMd: body.description,
      versionLabel: body.versionLabel,
      sourceType: body.sourceType,
      policy: parseAccessPolicy({ visibility: body.visibility }),
    });

    return c.json({ ok: true, data: { resource: publicResource(resource) } }, 201);
  });

  router.patch('/resources/:resourceId', requirePermission(PERMISSION.DOWNLOAD_RESOURCE_EDIT_OWN), async (c) => {
    const body = await parseBody(
      c,
      z.object({
        title: z.string().min(1).max(80).optional(),
        summary: z.string().max(300).optional(),
        description: z.string().max(20_000).optional(),
        versionLabel: z.string().max(40).nullable().optional(),
        categorySlug: z.string().optional(),
        visibility: z.enum(['public', 'login', 'invite']).optional(),
      }),
    );
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();

    const current = await getResource(handle.db, c.req.param('resourceId'));
    if (!current) throw errors.notFound('资源不存在');
    await assertAuthorOrOwner(current, auth.userId, auth.subject.role);

    const categoryId = body.categorySlug ? (await getCategoryBySlug(handle.db, body.categorySlug))?.id : undefined;
    const { parseAccessPolicy } = await import('@ycomm/config');
    const updated = await updateResourceMetadata(handle.db, current.id, {
      title: body.title,
      summary: body.summary,
      descriptionMd: body.description,
      versionLabel: body.versionLabel,
      categoryId,
      policy: body.visibility !== undefined ? parseAccessPolicy({ visibility: body.visibility }) : undefined,
    });
    return c.json({ ok: true, data: { resource: publicResource({ ...current, ...updated }) } });
  });

  router.post('/resources/:resourceId/withdraw', requirePermission(PERMISSION.DOWNLOAD_RESOURCE_EDIT_OWN), async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const current = await getResource(handle.db, c.req.param('resourceId'));
    if (!current) throw errors.notFound('资源不存在');
    await assertAuthorOrOwner(current, auth.userId, auth.subject.role);
    await withdrawResource(handle.db, current.id);
    return c.json({ ok: true, data: null });
  });

  // ---- links ------------------------------------------------------------
  router.post('/resources/:resourceId/links', requirePermission(PERMISSION.DOWNLOAD_RESOURCE_EDIT_OWN), async (c) => {
    const body = await parseBody(c, addLinkSchema);
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const current = await getResource(handle.db, c.req.param('resourceId'));
    if (!current) throw errors.notFound('资源不存在');
    await assertAuthorOrOwner(current, auth.userId, auth.subject.role);

    const link = await addLink(handle.db, {
      resourceId: current.id,
      kind: body.kind,
      sourceType: body.sourceType,
      url: body.url,
      extractCode: body.extractCode,
      localPath: body.localPath,
      fileName: body.fileName,
      sizeBytes: body.sizeBytes,
    });
    // The URL never travels back to the client.
    return c.json({ ok: true, data: { link: { id: link.id, kind: link.kind, source_type: link.source_type, status: link.status } } });
  });

  router.post('/resources/:resourceId/upload', requirePermission(PERMISSION.DOWNLOAD_RESOURCE_CREATE), async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const current = await getResource(handle.db, c.req.param('resourceId'));
    if (!current) throw errors.notFound('资源不存在');
    await assertAuthorOrOwner(current, auth.userId, auth.subject.role);

    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') {
      throw errors.validation({ issues: [{ path: 'file', message: '缺少上传文件' }] });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = saveLocalFile(buffer, { kind: 'resource', originalName: file.name });

    await addLink(handle.db, {
      resourceId: current.id,
      sourceType: 'local',
      localPath: saved.localPath,
      fileName: saved.fileName,
      sizeBytes: saved.sizeBytes,
    });
    return c.json({ ok: true, data: { file: { name: saved.fileName, size: saved.sizeBytes } } }, 201);
  });

  router.delete('/links/:linkId', requirePermission(PERMISSION.DOWNLOAD_RESOURCE_EDIT_OWN), async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const resourceId = await getResourceIdByLink(handle.db, c.req.param('linkId'));
    if (!resourceId) throw errors.notFound('链接不存在');
    const current = await getResource(handle.db, resourceId);
    if (!current) throw errors.notFound('资源不存在');
    await assertAuthorOrOwner(current, auth.userId, auth.subject.role);
    await removeLink(handle.db, c.req.param('linkId'));
    return c.json({ ok: true, data: null });
  });

  router.post('/links/:linkId/report', requirePermission(PERMISSION.DOWNLOAD_LINK_REPORT), rateLimitByUser('report'), async (c) => {
    const body = await parseBody(c, reportSchema);
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    await reportDeadLink(handle.db, { linkId: c.req.param('linkId'), reporterId: auth.userId, reason: body.reason });
    return c.json({ ok: true, data: null });
  });

  router.post('/resources/:resourceId/report', requirePermission(PERMISSION.DOWNLOAD_LINK_REPORT), rateLimitByUser('report'), async (c) => {
    const body = await parseBody(c, reportSchema);
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    await reportDeadLinkByResource(handle.db, {
      resourceId: c.req.param('resourceId'),
      reporterId: auth.userId,
      reason: body.reason,
    });
    return c.json({ ok: true, data: null });
  });

  // ---- the gated fetch --------------------------------------------------
  router.get('/resources/:resourceId/go', async (c) => {
    const handle = await getDb();
    const subject = c.get('auth')?.subject ?? null;

    const outcome = await authorizedFetch(handle.db, subject, c.req.param('resourceId'), {
      ip: clientIp(c),
      userAgent: c.req.header('user-agent'),
    });

    if (outcome.kind === 'external') {
      // Redirect: the URL itself is never handed to client scripts.
      return c.redirect(outcome.url, 302);
    }

    const file = openLocalFile(outcome.localPath, parseRange(c.req.header('range'), outcome.sizeBytes ?? undefined));
    const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(outcome.fileName)}`;
    if (file.size === file.end - file.start + 1 && !c.req.header('range')) {
      c.header('Content-Length', String(file.size));
    } else {
      c.header('Content-Range', `bytes ${file.start}-${file.end}/${file.size}`);
      c.status(206);
    }
    c.header('Content-Type', 'application/octet-stream');
    c.header('Content-Disposition', disposition);
    c.header('Accept-Ranges', 'bytes');
    return c.body(file.stream as never);
  });

  router.get('/resources/:resourceId/extract-code', async (c) => {
    const handle = await getDb();
    const subject = c.get('auth')?.subject ?? null;
    const code = await authorizedExtractCode(handle.db, subject, c.req.param('resourceId'));
    return c.json({ ok: true, data: { extractCode: code } });
  });

  // ---- review decisions shared with the moderation queue ----------------
  router.post('/moderation/:itemId/decide', requirePermission(PERMISSION.DOWNLOAD_RESOURCE_AUDIT), async (c) => {
    const body = await parseBody(c, decideSchema);
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const items = await listQueued(handle.db, {});
    const item = items.find((entry) => entry.id === c.req.param('itemId'));
    if (!item || (item.target_type !== 'download_resource' && item.target_type !== 'download_link')) {
      throw errors.notFound('审核项不存在');
    }
    await decide(handle.db, item.id, { decision: body.decision, by: auth.userId, note: body.note });
    return c.json({ ok: true, data: null });
  });

  return router;
}

/** Author (uploader) or staff override for resource edits. */
async function assertAuthorOrOwner(
  resource: { author_id: string },
  userId: string,
  role: 'member' | 'admin' | 'owner',
): Promise<void> {
  if (resource.author_id === userId || role === 'owner') return;
  throw errors.forbidden('只能编辑自己上传的资源');
}

/** Strip anything sensitive (links stay in the DB; policies stay server-side). */
function publicResource(resource: {
  id: string;
  category_id: string;
  author_id: string;
  title: string;
  summary: string;
  description_md: string;
  cover_path: string | null;
  version_label: string | null;
  source_type: string;
  status: string;
  download_count: number;
  view_count: number;
  published_at: Date | null;
  created_at: Date;
}) {
  return {
    id: resource.id,
    categoryId: resource.category_id,
    authorId: resource.author_id,
    title: resource.title,
    summary: resource.summary,
    descriptionMd: resource.description_md,
    versionLabel: resource.version_label,
    sourceType: resource.source_type,
    status: resource.status,
    downloadCount: resource.download_count,
    viewCount: resource.view_count,
    publishedAt: resource.published_at,
    createdAt: resource.created_at,
  };
}

function parseRange(rangeHeader: string | undefined, size: number | undefined): { start: number; end: number } | undefined {
  if (!rangeHeader || size === undefined) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) return undefined;
  const start = match[1] ? Number.parseInt(match[1], 10) : 0;
  const end = match[2] ? Number.parseInt(match[2], 10) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= size || start > end) return undefined;
  return { start, end };
}