import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import { listNotificationGroups, markNotificationsRead, notificationUnreadCount } from '@ycomm/notify';
import type { AppVariables } from '../context';
import { requireAuth, sessionAuth } from '../middleware/session';
import { parseBody } from './forum';

const readSchema = z.object({
  /** 通知组 key 列表；空数组或 ['*'] = 全部已读。 */
  keys: z.array(z.string()).optional(),
});

/**
 * 站内通知中心：
 * - GET  /api/notifications          分组通知（点赞/分享/浏览/回复聚合，管理员操作淡橙）
 * - GET  /api/notifications/unread-count  未读数（铃铛红点）
 * - POST /api/notifications/read     标记已读（指定组或全部）
 */
export function notificationsRoutes(): Hono<{ Variables: AppVariables }> {
  const router = new Hono<{ Variables: AppVariables }>();
  router.use('*', sessionAuth);

  router.get('/', requireAuth, async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const groups = await listNotificationGroups(handle.db, auth.userId);
    return c.json({ ok: true, data: { groups } });
  });

  router.get('/unread-count', requireAuth, async (c) => {
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    const count = await notificationUnreadCount(handle.db, auth.userId);
    return c.json({ ok: true, data: { count } });
  });

  router.post('/read', requireAuth, async (c) => {
    const body = await parseBody(c, readSchema);
    const handle = await getDb();
    const auth = c.get('auth');
    if (!auth) throw errors.unauthenticated();
    await markNotificationsRead(handle.db, auth.userId, body.keys ?? []);
    const count = await notificationUnreadCount(handle.db, auth.userId);
    return c.json({ ok: true, data: { count } });
  });

  return router;
}