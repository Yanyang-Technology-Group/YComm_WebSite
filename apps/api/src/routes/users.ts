import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getDb, schema, type Db } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import {
  followUser,
  getPublicProfile,
  listFollowerUsers,
  listFollowingUsers,
  listUsers,
  unfollowUser,
  type UserProfileView,
  type FollowedUserView,
} from '@ycomm/identity';
import { logAudit } from '@ycomm/audit';
import type { AppVariables } from '../context';
import { clientIp, sessionAuth, requireAuth } from '../middleware/session';

/** 按用户名解析用户（注销/封禁账号的主页不公开）。 */
async function resolveUsername(db: Db, username: string) {
  const rows = await db
    .select({ id: schema.users.id, state: schema.users.state })
    .from(schema.users)
    .where(eq(schema.users.username, username.trim()))
    .limit(1);
  const user = rows[0];
  if (!user || user.state === 'deleted' || user.state === 'banned') throw errors.notFound('用户不存在');
  return user;
}

/**
 * 用户主页与关注/粉丝。
 * - GET /users/:username          公开主页（含关注/粉丝数、关注可见度）
 * - GET /users/:username/following 关注列表（按可见度过滤）
 * - GET /users/:username/followers 粉丝列表（按可见度过滤）
 * - POST /users/:username/follow 关注 / POST /users/:username/unfollow 取消关注
 */
export function usersRoutes(): Hono<{ Variables: AppVariables }> {
  const router = new Hono<{ Variables: AppVariables }>();
  router.use('*', sessionAuth);

  router.get('/:username', async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    const profile: UserProfileView = await getPublicProfile(handle.db, c.req.param('username'), auth?.userId ?? null);
    return c.json({ ok: true, data: { profile } });
  });

  router.get('/:username/following', async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    const target = await resolveUsername(handle.db, c.req.param('username'));
    const visible = (await getPublicProfile(handle.db, target.id, auth?.userId ?? null)).listsVisible;
    if (!visible) throw errors.forbidden('对方设置了关注列表可见度，暂不可见');
    const items: FollowedUserView[] = await listFollowingUsers(handle.db, target.id, auth?.userId ?? null);
    return c.json({ ok: true, data: { items } });
  });

  router.get('/:username/followers', async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    const target = await resolveUsername(handle.db, c.req.param('username'));
    const visible = (await getPublicProfile(handle.db, target.id, auth?.userId ?? null)).listsVisible;
    if (!visible) throw errors.forbidden('对方设置了粉丝列表可见度，暂不可见');
    const items: FollowedUserView[] = await listFollowerUsers(handle.db, target.id, auth?.userId ?? null);
    return c.json({ ok: true, data: { items } });
  });

  router.post('/:username/follow', requireAuth, async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const target = await resolveUsername(handle.db, c.req.param('username'));
    await followUser(handle.db, auth.userId, target.id);
    await logAudit(handle.db, {
      actorId: auth.userId,
      actorIp: clientIp(c),
      action: 'user.follow',
      targetType: 'user',
      targetId: target.id,
    });
    return c.json({ ok: true, data: { following: true } });
  });

  router.post('/:username/unfollow', requireAuth, async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const target = await resolveUsername(handle.db, c.req.param('username'));
    await unfollowUser(handle.db, auth.userId, target.id);
    await logAudit(handle.db, {
      actorId: auth.userId,
      actorIp: clientIp(c),
      action: 'user.unfollow',
      targetType: 'user',
      targetId: target.id,
    });
    return c.json({ ok: true, data: { following: false } });
  });

  // 用户列表查询也暴露给前端（管理员用；普通用户搜人看主页）
  router.get('/', async (c) => {
    const handle = await getDb();
    const result = await listUsers(handle.db, {
      q: c.req.query('q') ?? undefined,
      offset: Number.parseInt(c.req.query('offset') ?? '0', 10) || 0,
      limit: 20,
    });
    const items = result.users.map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      avatarPath: user.avatar_path,
      role: user.role,
      level: user.level,
    }));
    return c.json({ ok: true, data: { items, total: result.total } });
  });

  return router;
}