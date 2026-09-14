import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema, type Db } from '@ycomm/db';
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
  resetUserPassword,
  setRuntimeSetting,
  setUserRole,
  toPublicUser,
  unbanUser,
  unmuteUser,
  type UserRecord,
} from '@ycomm/identity';
import { listAuditLogs, logAudit } from '@ycomm/audit';
import { decide, listQueued } from '@ycomm/moderation';
import { createCard, deleteCard, listAllCards, listAllResources, reviewCard, updateCard } from '@ycomm/downloads';
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
import { verifyCaptcha } from '../middleware/captcha';
import { parseBody } from './forum';

const roleSchema = z.object({ role: z.enum(['member', 'admin', 'owner']) });
const banSchema = z.object({
  reason: z.string().max(300).optional(),
  /** null / 缺省 = 永久封禁。 */
  until: z.string().datetime().nullable().optional(),
});
const muteSchema = z.object({
  /** null / 缺省 = 永久禁言。 */
  until: z.string().datetime().nullable().optional(),
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
  /** 谁可以发主题/帖子：all=所有人 / staff=仅管理员与站长。 */
  postingPolicy: z.enum(['all', 'staff']).default('all'),
});

const boardUpdateSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  description: z.string().max(500).optional(),
  sortOrder: z.number().int().optional(),
  visibility: z.enum(['public', 'login', 'invite']).optional(),
  postingPolicy: z.enum(['all', 'staff']).optional(),
});

const cardCreateSchema = z.object({
  parentId: z.string().nullable().optional(),
  title: z.string().min(1).max(80),
  subtitle: z.string().max(200).optional(),
  subtitleUrl: z.string().max(2000).nullable().optional(),
  kind: z.enum(['container', 'redirect', 'resources']).default('container'),
  redirectUrl: z.string().max(2000).nullable().optional(),
  w: z.number().int().min(1).max(6).optional(),
  h: z.number().int().min(1).max(6).optional(),
  visibility: z.enum(['public', 'login', 'invite', 'staff']).default('public'),
  position: z.number().int().optional(),
});

const cardUpdateSchema = z.object({
  parentId: z.string().nullable().optional(),
  title: z.string().min(1).max(80).optional(),
  subtitle: z.string().max(200).optional(),
  subtitleUrl: z.string().max(2000).nullable().optional(),
  kind: z.enum(['container', 'redirect', 'resources']).optional(),
  redirectUrl: z.string().max(2000).nullable().optional(),
  w: z.number().int().min(1).max(6).optional(),
  h: z.number().int().min(1).max(6).optional(),
  visibility: z.enum(['public', 'login', 'invite', 'staff']).optional(),
  position: z.number().int().optional(),
});

const cardReviewSchema = z.object({
  decision: z.enum(['approve', 'reject']),
});

const captchaBodySchema = z.object({ captchaToken: z.string().min(1).optional() });

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8).max(200),
  captchaToken: z.string().min(1).optional(),
});

const adminUser = (user: UserRecord) => ({
  ...toPublicUser(user),
  email: user.email,
  postCount: user.post_count,
  likeReceivedCount: user.like_received_count,
  createdAt: user.created_at,
  // 封禁/禁言到期时间（null = 永久或未生效），前端据此显示剩余时间。
  mutedUntil: user.muted_until,
  bannedUntil: user.banned_until,
  muteReason: user.mute_reason,
  banReason: user.ban_reason,
});

/** The moderation decision permission depends on what is being decided. */
function permissionForTarget(targetType: string): (typeof PERMISSION)[keyof typeof PERMISSION] {
  if (targetType === 'download_resource') return PERMISSION.DOWNLOAD_RESOURCE_AUDIT;
  if (targetType === 'download_link') return PERMISSION.DOWNLOAD_RESOURCE_DELETE_ANY;
  return PERMISSION.FORUM_CONTENT_AUDIT;
}

/**
 * 统一的管理动作审计：谁（用户名会由日志查询关联出来）、从哪个 IP、做了什么、
 * 对象是谁，全都落 `audit_logs`。管理员在「操作日志」页面能看到完整流水。
 */
async function auditAdmin(
  db: Db,
  c: Context<{ Variables: AppVariables }>,
  entry: {
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  const auth = c.get('auth');
  if (!auth) return;
  await logAudit(db, {
    actorId: auth.userId,
    actorIp: clientIp(c),
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    meta: entry.meta ?? {},
  });
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
    const updated = await banUser(
      handle.db,
      { id: auth.userId, role: auth.subject.role },
      c.req.param('userId'),
      { reason: body.reason, until: body.until ? new Date(body.until) : null },
    );
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

  /** 站长直接注销任意账号：立即生效，无 3 天冷静期；同样要求人机验证。 */
  router.post('/users/:userId/delete', requirePermission(PERMISSION.ADMIN_DASHBOARD_ACCESS), async (c) => {
    const body = await parseBody(c, captchaBodySchema);
    await verifyCaptcha(body.captchaToken);
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

  /** 站长更改任意用户密码（仅 owner）：需人机验证；改完该用户全部会话失效。 */
  router.post('/users/:userId/reset-password', requirePermission(PERMISSION.ADMIN_DASHBOARD_ACCESS), async (c) => {
    const body = await parseBody(c, resetPasswordSchema);
    await verifyCaptcha(body.captchaToken);
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const updated = await resetUserPassword(
      handle.db,
      { id: auth.userId, role: auth.subject.role },
      c.req.param('userId'),
      body.newPassword,
    );
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
    await auditAdmin(handle.db, c, {
      action: `moderation.${body.decision}`,
      targetType: item.target_type,
      targetId: item.target_id,
      meta: { itemId: item.id, note: body.note ?? null, reason: item.reason ?? null },
    });
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
    const actionPrefix = c.req.query('action') ?? undefined;
    const result = await listAuditLogs(handle.db, {
      actionPrefix,
      offset: Number.parseInt(c.req.query('offset') ?? '0', 10) || 0,
      limit: Math.min(Number.parseInt(c.req.query('limit') ?? '50', 10) || 50, 200),
    });
    return c.json({ ok: true, data: { entries: result.entries, total: result.total } });
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
    await auditAdmin(handle.db, c, {
      action: 'admin.invite.created',
      targetType: 'invite_code',
      targetId: row.id,
      meta: { code: row.code, name: body.name, maxUses: row.maxUses },
    });
    return c.json({ ok: true, data: { inviteCode: row } }, 201);
  });

  router.delete('/invites/:inviteId', requirePermission(PERMISSION.INVITE_CREATE), async (c) => {
    const handle = await getDb();
    const inviteId = c.req.param('inviteId');
    await deleteInviteCode(handle.db, inviteId);
    await auditAdmin(handle.db, c, {
      action: 'admin.invite.deleted',
      targetType: 'invite_code',
      targetId: inviteId,
    });
    return c.json({ ok: true, data: null });
  });

  /** 使用了某个注册码的用户列表（注册码列表点「已用/上限」弹窗看）。 */
  router.get('/invites/:inviteId/uses', requirePermission(PERMISSION.INVITE_CREATE), async (c) => {
    const handle = await getDb();
    const rows = await handle.db
      .select({
        userId: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.display_name,
        avatarPath: schema.users.avatar_path,
        role: schema.users.role,
        state: schema.users.state,
        usedAt: schema.inviteCodeUses.used_at,
      })
      .from(schema.inviteCodeUses)
      .innerJoin(schema.users, eq(schema.inviteCodeUses.user_id, schema.users.id))
      .where(eq(schema.inviteCodeUses.invite_code_id, c.req.param('inviteId')))
      .orderBy(schema.inviteCodeUses.used_at);
    const userList = rows.map((row) => ({
      userId: row.userId,
      username: row.username,
      displayName: row.displayName,
      avatarPath: row.avatarPath,
      role: row.role,
      state: row.state,
      usedAt: row.usedAt?.toISOString() ?? null,
    }));
    return c.json({ ok: true, data: { users: userList } });
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
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const card = await createCard(
      handle.db,
      {
        parentId: body.parentId ?? null,
        title: body.title,
        subtitle: body.subtitle,
        subtitleUrl: body.subtitleUrl,
        kind: body.kind,
        redirectUrl: body.redirectUrl,
        w: body.w,
        h: body.h,
        visibility: body.visibility,
        position: body.position,
      },
      auth.subject.role,
    );
    await auditAdmin(handle.db, c, {
      action: 'admin.card.created',
      targetType: 'download_card',
      targetId: card.id,
      meta: {
        title: card.title,
        kind: card.kind,
        parentId: card.parent_id,
        visibility: card.visibility,
        status: card.status,
      },
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
      subtitleUrl: body.subtitleUrl,
      kind: body.kind,
      redirectUrl: body.redirectUrl,
      w: body.w,
      h: body.h,
      visibility: body.visibility,
      position: body.position,
    });
    await auditAdmin(handle.db, c, {
      action: 'admin.card.updated',
      targetType: 'download_card',
      targetId: card.id,
      meta: { title: card.title, kind: card.kind, parentId: card.parent_id, visibility: card.visibility, ...body },
    });
    return c.json({ ok: true, data: { card: adminCard(card) } });
  });

  /** 只有站长能审核卡片：通过后才会对外可见。 */
  router.post('/cards/:cardId/review', requirePermission(PERMISSION.ADMIN_DASHBOARD_ACCESS), async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    if (auth.subject.role !== 'owner') throw errors.forbidden('只有站长可以审核下载卡片');
    const body = await parseBody(c, cardReviewSchema);
    const cardId = c.req.param('cardId');
    const card = await reviewCard(handle.db, cardId, body.decision);
    await auditAdmin(handle.db, c, {
      action: body.decision === 'approve' ? 'admin.card.approved' : 'admin.card.rejected',
      targetType: 'download_card',
      targetId: cardId,
      meta: { title: card.title },
    });
    return c.json({ ok: true, data: { card: adminCard(card) } });
  });

  router.delete('/cards/:cardId', requirePermission(PERMISSION.ADMIN_DASHBOARD_ACCESS), async (c) => {
    const handle = await getDb();
    const cardId = c.req.param('cardId');
    await deleteCard(handle.db, cardId);
    await auditAdmin(handle.db, c, {
      action: 'admin.card.deleted',
      targetType: 'download_card',
      targetId: cardId,
    });
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
      postingPolicy: body.postingPolicy,
    });
    const view: BoardView = { ...board, policy: parseAccessPolicy(board.access_policy) };
    await auditAdmin(handle.db, c, {
      action: 'admin.board.created',
      targetType: 'board',
      targetId: board.id,
      meta: { slug: board.slug, name: board.name, visibility: body.visibility, postingPolicy: board.posting_policy },
    });
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
      postingPolicy: body.postingPolicy,
    });
    const view: BoardView = { ...board, policy: parseAccessPolicy(board.access_policy) };
    await auditAdmin(handle.db, c, {
      action: 'admin.board.updated',
      targetType: 'board',
      targetId: board.id,
      meta: { slug: board.slug, ...body },
    });
    return c.json({ ok: true, data: { board: adminBoard(view) } });
  });

  /** 删除 = 软删除（归档）：主题与回帖数据保留，可随时恢复。 */
  router.delete('/boards/:boardId', requirePermission(PERMISSION.FORUM_BOARD_MANAGE), async (c) => {
    const handle = await getDb();
    const boardId = c.req.param('boardId');
    await archiveBoard(handle.db, boardId);
    await auditAdmin(handle.db, c, {
      action: 'admin.board.archived',
      targetType: 'board',
      targetId: boardId,
    });
    return c.json({ ok: true, data: null });
  });

  router.post('/boards/:boardId/restore', requirePermission(PERMISSION.FORUM_BOARD_MANAGE), async (c) => {
    const handle = await getDb();
    const boardId = c.req.param('boardId');
    await restoreBoard(handle.db, boardId);
    await auditAdmin(handle.db, c, {
      action: 'admin.board.restored',
      targetType: 'board',
      targetId: boardId,
    });
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
    postingPolicy: board.posting_policy,
    archivedAt: board.archived_at,
    createdAt: board.created_at,
  };
}

function adminCard(card: {
  id: string;
  parent_id: string | null;
  title: string;
  subtitle: string;
  subtitle_url: string | null;
  kind: string;
  redirect_url: string | null;
  w: number;
  h: number;
  visibility: string;
  position: number;
  status: string;
}) {
  return {
    id: card.id,
    parentId: card.parent_id,
    title: card.title,
    subtitle: card.subtitle,
    subtitleUrl: card.subtitle_url,
    kind: card.kind,
    redirectUrl: card.redirect_url,
    w: card.w,
    h: card.h,
    visibility: card.visibility,
    position: card.position,
    status: card.status,
  };
}