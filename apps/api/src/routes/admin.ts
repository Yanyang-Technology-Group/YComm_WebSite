import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import { PERMISSION } from '@ycomm/config';
import { assertPermission } from '@ycomm/access';
import {
  banUser,
  listRuntimeSettings,
  listUsers,
  muteUser,
  setRuntimeSetting,
  setUserRole,
  toPublicUser,
  unbanUser,
  unmuteUser,
  type UserRecord,
} from '@ycomm/identity';
import { listRecentAudit } from '@ycomm/audit';
import { decide, listQueued } from '@ycomm/moderation';
import { listAllResources } from '@ycomm/downloads';
import type { AppVariables } from '../context';
import { sessionAuth } from '../middleware/session';
import { requirePermission } from '../middleware/permission';
import { parseBody } from './forum';

const roleSchema = z.object({ role: z.enum(['member', 'admin', 'owner']) });
const banSchema = z.object({ reason: z.string().max(300).optional() });
const muteSchema = z.object({
  until: z.string().datetime().optional(),
  reason: z.string().max(300).optional(),
});
const settingSchema = z.object({
  key: z.string().min(1).max(64),
  value: z.unknown(),
});
const decideSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(500).optional(),
});

const adminUser = (user: UserRecord) => ({
  ...toPublicUser(user),
  email: user.email,
  postCount: user.post_count,
  likeReceivedCount: user.like_received_count,
  createdAt: user.created_at,
});

/** The moderation decision permission depends on what is being decided. */
function permissionForTarget(targetType: string): (typeof PERMISSION)[keyof typeof PERMISSION] {
  if (targetType === 'download_resource') return PERMISSION.DOWNLOAD_RESOURCE_AUDIT;
  if (targetType === 'download_link') return PERMISSION.DOWNLOAD_RESOURCE_DELETE_ANY;
  return PERMISSION.FORUM_CONTENT_AUDIT;
}

export function adminRoutes(): Hono<{ Variables: AppVariables }> {
  const router = new Hono<{ Variables: AppVariables }>();
  router.use('*', sessionAuth);

  router.get('/users', requirePermission(PERMISSION.ADMIN_DASHBOARD_ACCESS), async (c) => {
    const handle = await getDb();
    const result = await listUsers(handle.db, {
      q: c.req.query('q') ?? undefined,
      offset: Number.parseInt(c.req.query('offset') ?? '0', 10) || 0,
      limit: Math.min(Number.parseInt(c.req.query('limit') ?? '20', 10) || 20, 100),
    });
    return c.json({ ok: true, data: { users: result.users.map(adminUser), total: result.total } });
  });

  router.patch('/users/:userId/role', requirePermission(PERMISSION.USER_ROLE_ASSIGN), async (c) => {
    const body = await parseBody(c, roleSchema);
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const updated = await setUserRole(handle.db, { id: auth.userId, role: auth.subject.role }, c.req.param('userId'), body.role);
    return c.json({ ok: true, data: { user: adminUser(updated) } });
  });

  router.post('/users/:userId/ban', requirePermission(PERMISSION.USER_BAN), async (c) => {
    const body = await parseBody(c, banSchema);
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const updated = await banUser(handle.db, { id: auth.userId, role: auth.subject.role }, c.req.param('userId'), body.reason);
    return c.json({ ok: true, data: { user: adminUser(updated) } });
  });

  router.post('/users/:userId/unban', requirePermission(PERMISSION.USER_BAN), async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const updated = await unbanUser(handle.db, { id: auth.userId, role: auth.subject.role }, c.req.param('userId'));
    return c.json({ ok: true, data: { user: adminUser(updated) } });
  });

  router.post('/users/:userId/mute', requirePermission(PERMISSION.USER_MUTE), async (c) => {
    const body = await parseBody(c, muteSchema);
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const updated = await muteUser(
      handle.db,
      { id: auth.userId, role: auth.subject.role },
      c.req.param('userId'),
      { until: body.until ? new Date(body.until) : null, reason: body.reason },
    );
    return c.json({ ok: true, data: { user: adminUser(updated) } });
  });

  router.post('/users/:userId/unmute', requirePermission(PERMISSION.USER_MUTE), async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const updated = await unmuteUser(handle.db, { id: auth.userId, role: auth.subject.role }, c.req.param('userId'));
    return c.json({ ok: true, data: { user: adminUser(updated) } });
  });

  router.get('/settings', requirePermission(PERMISSION.ADMIN_DASHBOARD_ACCESS), async (c) => {
    const handle = await getDb();
    const settings = await listRuntimeSettings(handle.db);
    return c.json({ ok: true, data: { settings } });
  });

  router.patch('/settings', requirePermission(PERMISSION.SITE_CONFIG_EDIT), async (c) => {
    const body = await parseBody(c, settingSchema);
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    await setRuntimeSetting(handle.db, { id: auth.userId, role: auth.subject.role }, body.key, body.value);
    return c.json({ ok: true, data: null });
  });

  router.get('/moderation', requirePermission(PERMISSION.ADMIN_DASHBOARD_ACCESS), async (c) => {
    const handle = await getDb();
    const items = await listQueued(handle.db, {
      offset: Number.parseInt(c.req.query('offset') ?? '0', 10) || 0,
      limit: Math.min(Number.parseInt(c.req.query('limit') ?? '50', 10) || 50, 100),
    });
    return c.json({ ok: true, data: { items } });
  });

  router.post('/moderation/:itemId/decide', async (c) => {
    const body = await parseBody(c, decideSchema);
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const items = await listQueued(handle.db, {});
    const item = items.find((entry) => entry.id === c.req.param('itemId'));
    if (!item) throw errors.notFound('审核项不存在');
    assertPermission(auth.subject, permissionForTarget(item.target_type));
    await decide(handle.db, item.id, { decision: body.decision, by: auth.userId, note: body.note });
    return c.json({ ok: true, data: null });
  });

  router.get('/resources', requirePermission(PERMISSION.ADMIN_DASHBOARD_ACCESS), async (c) => {
    const handle = await getDb();
    const result = await listAllResources(handle.db, {
      status: c.req.query('status') as never,
      offset: Number.parseInt(c.req.query('offset') ?? '0', 10) || 0,
      limit: Math.min(Number.parseInt(c.req.query('limit') ?? '50', 10) || 50, 200),
    });
    const resources = result.resources.map((resource) => ({
      id: resource.id,
      categoryId: resource.category_id,
      authorId: resource.author_id,
      title: resource.title,
      versionLabel: resource.version_label,
      sourceType: resource.source_type,
      status: resource.status,
      downloadCount: resource.download_count,
      createdAt: resource.created_at,
    }));
    return c.json({ ok: true, data: { resources, total: result.total } });
  });

  router.get('/audit', requirePermission(PERMISSION.SYSTEM_AUDITLOG_VIEW), async (c) => {
    const handle = await getDb();
    const entries = await listRecentAudit(handle.db, {
      limit: Math.min(Number.parseInt(c.req.query('limit') ?? '50', 10) || 50, 200),
    });
    return c.json({ ok: true, data: { entries } });
  });

  return router;
}