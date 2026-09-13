import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import { PERMISSION, parseAccessPolicy } from '@ycomm/config';
import { assertPermission } from '@ycomm/access';
import {
  adminCreateInviteCode,
  banUser,
  deleteAccountNow,
  deleteInviteCode,
  listInviteCodes,
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
import { listRecentAudit, logAudit } from '@ycomm/audit';
import { decide, listQueued } from '@ycomm/moderation';
import { createCard, deleteCard, listAllCards, listAllResources, updateCard } from '@ycomm/downloads';
import {
  archiveBoard,
  createBoard,
  listAllBoards,
  restoreBoard,
  updateBoard,
  type BoardView,
} from '@ycomm/forum';
import type { AppVariables } from '../context';
import { sessionAuth, clientIp } from '../middleware/session';
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

const inviteCreateSchema = z.object({
  name: z.string().min(1).max(60),
  code: z.string().max(10).optional(),
  maxUses: z.number().int().min(1).max(1000).optional(),
});

const boardCreateSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/, 'slug 仅限小写字母/数字/连字符'),
  name: z.string().min(2).max(60),
  description: z.string().max(500).default(''),
  sortOrder: z.number().int().optional(),
  visibility: z.enum(['public', 'login', 'invite']).default('public'),
});

const boardUpdateSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  description: z.string().max(500).optional(),
  sortOrder: z.number().int().optional(),
  visibility: z.enum(['public', 'login', 'invite']).optional(),
});

const cardCreateSchema = z.object({
  parentId: z.string().nullable().optional(),
  title: z.string().min(1).max(80),
  subtitle: z.string().max(200).optional(),
  kind: z.enum(['container', 'redirect', 'resources']).default('container'),
  redirectUrl: z.string().max(2000).nullable().optional(),
  w: z.number().int().min(1).max(6).optional(),
  h: z.number().int().min(1).max(6).optional(),
  visibility: z.enum(['public', 'login', 'staff']).default('public'),
  position: z.number().int().optional(),
});

const cardUpdateSchema = z.object({
  parentId: z.string().nullable().optional(),
  title: z.string().min(1).max(80).optional(),
  subtitle: z.string().max(200).optional(),
  kind: z.enum(['container', 'redirect', 'resources']).optional(),
  redirectUrl: z.string().max(2000).nullable().optional(),
  w: z.number().int().min(1).max(6).optional(),
  h: z.number().int().min(1).max(6).optional(),
  visibility: z.enum(['public', 'login', 'staff']).optional(),
  position: z.number().int().optional(),
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

  /** 站长直接注销任意账号：立即生效，无 3 天冷静期。 */
  router.post('/users/:userId/delete', requirePermission(PERMISSION.ADMIN_DASHBOARD_ACCESS), async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    if (auth.subject.role !== 'owner') throw errors.forbidden('仅站长可注销账号');
    const targetId = c.req.param('userId');
    await deleteAccountNow(handle.db, targetId);
    await logAudit(handle.db, {
      actorId: auth.userId,
      actorIp: clientIp(c),
      action: 'admin.user.deleted',
      targetType: 'user',
      targetId,
      meta: { via: 'owner', immediate: true },
    });
    return c.json({ ok: true, data: null });
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

  // ---- 注册码管理（管理员可创建/查看/删除） ---------------------------
  router.get('/invites', requirePermission(PERMISSION.INVITE_CREATE), async (c) => {
    const handle = await getDb();
    const inviteCodes = await listInviteCodes(handle.db);
    return c.json({ ok: true, data: { inviteCodes } });
  });

  router.post('/invites', requirePermission(PERMISSION.INVITE_CREATE), async (c) => {
    const body = await parseBody(c, inviteCreateSchema);
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const row = await adminCreateInviteCode(handle.db, {
      name: body.name,
      code: body.code,
      maxUses: body.maxUses,
      createdBy: auth.userId,
    });
    return c.json({ ok: true, data: { inviteCode: row } }, 201);
  });

  router.delete('/invites/:inviteId', requirePermission(PERMISSION.INVITE_CREATE), async (c) => {
    const handle = await getDb();
    await deleteInviteCode(handle.db, c.req.param('inviteId'));
    return c.json({ ok: true, data: null });
  });

  // ---- 下载区卡片门户（管理员增删改） ---------------------------------
  router.get('/cards', requirePermission(PERMISSION.ADMIN_DASHBOARD_ACCESS), async (c) => {
    const handle = await getDb();
    const cards = await listAllCards(handle.db);
    return c.json({ ok: true, data: { cards: cards.map(adminCard) } });
  });

  router.post('/cards', requirePermission(PERMISSION.ADMIN_DASHBOARD_ACCESS), async (c) => {
    const body = await parseBody(c, cardCreateSchema);
    const handle = await getDb();
    const card = await createCard(handle.db, {
      parentId: body.parentId ?? null,
      title: body.title,
      subtitle: body.subtitle,
      kind: body.kind,
      redirectUrl: body.redirectUrl,
      w: body.w,
      h: body.h,
      visibility: body.visibility,
      position: body.position,
    });
    return c.json({ ok: true, data: { card: adminCard(card) } }, 201);
  });

  router.patch('/cards/:cardId', requirePermission(PERMISSION.ADMIN_DASHBOARD_ACCESS), async (c) => {
    const body = await parseBody(c, cardUpdateSchema);
    const handle = await getDb();
    const card = await updateCard(handle.db, c.req.param('cardId'), {
      parentId: body.parentId,
      title: body.title,
      subtitle: body.subtitle,
      kind: body.kind,
      redirectUrl: body.redirectUrl,
      w: body.w,
      h: body.h,
      visibility: body.visibility,
      position: body.position,
    });
    return c.json({ ok: true, data: { card: adminCard(card) } });
  });

  router.delete('/cards/:cardId', requirePermission(PERMISSION.ADMIN_DASHBOARD_ACCESS), async (c) => {
    const handle = await getDb();
    await deleteCard(handle.db, c.req.param('cardId'));
    return c.json({ ok: true, data: null });
  });

  // ---- 版块管理（新增 / 改名 / 排序 / 访问设置 / 归档删除） ------------
  router.get('/boards', requirePermission(PERMISSION.FORUM_BOARD_MANAGE), async (c) => {
    const handle = await getDb();
    const boards = await listAllBoards(handle.db);
    return c.json({ ok: true, data: { boards: boards.map(adminBoard) } });
  });

  router.post('/boards', requirePermission(PERMISSION.FORUM_BOARD_MANAGE), async (c) => {
    const body = await parseBody(c, boardCreateSchema);
    const handle = await getDb();
    const board = await createBoard(handle.db, {
      slug: body.slug,
      name: body.name,
      description: body.description,
      sortOrder: body.sortOrder,
      policy: parseAccessPolicy({ visibility: body.visibility }),
    });
    const view: BoardView = { ...board, policy: parseAccessPolicy(board.access_policy) };
    return c.json({ ok: true, data: { board: adminBoard(view) } }, 201);
  });

  router.patch('/boards/:boardId', requirePermission(PERMISSION.FORUM_BOARD_MANAGE), async (c) => {
    const body = await parseBody(c, boardUpdateSchema);
    const handle = await getDb();
    const board = await updateBoard(handle.db, c.req.param('boardId'), {
      name: body.name,
      description: body.description,
      sortOrder: body.sortOrder,
      policy: body.visibility !== undefined ? parseAccessPolicy({ visibility: body.visibility }) : undefined,
    });
    const view: BoardView = { ...board, policy: parseAccessPolicy(board.access_policy) };
    return c.json({ ok: true, data: { board: adminBoard(view) } });
  });

  /** 删除 = 软删除（归档）：主题与回帖数据保留，可随时恢复。 */
  router.delete('/boards/:boardId', requirePermission(PERMISSION.FORUM_BOARD_MANAGE), async (c) => {
    const handle = await getDb();
    await archiveBoard(handle.db, c.req.param('boardId'));
    return c.json({ ok: true, data: null });
  });

  router.post('/boards/:boardId/restore', requirePermission(PERMISSION.FORUM_BOARD_MANAGE), async (c) => {
    const handle = await getDb();
    await restoreBoard(handle.db, c.req.param('boardId'));
    return c.json({ ok: true, data: null });
  });

  return router;
}

function adminBoard(board: BoardView) {
  return {
    id: board.id,
    slug: board.slug,
    name: board.name,
    description: board.description,
    parentId: board.parent_id,
    sortOrder: board.sort_order,
    visibility: board.policy.visibility,
    minLevel: board.policy.minLevel,
    requireInvite: board.policy.requireInvite,
    archivedAt: board.archived_at,
    createdAt: board.created_at,
  };
}

function adminCard(card: {
  id: string;
  parent_id: string | null;
  title: string;
  subtitle: string;
  kind: string;
  redirect_url: string | null;
  w: number;
  h: number;
  visibility: string;
  position: number;
}) {
  return {
    id: card.id,
    parentId: card.parent_id,
    title: card.title,
    subtitle: card.subtitle,
    kind: card.kind,
    redirectUrl: card.redirect_url,
    w: card.w,
    h: card.h,
    visibility: card.visibility,
    position: card.position,
  };
}