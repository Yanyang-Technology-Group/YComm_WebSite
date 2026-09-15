import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { errors } from '@ycomm/kernel';

/**
 * 徽章系统（多徽章）：
 * - badges 定义（文字 + 渐变两色，管理员可视化创建）；
 * - user_badges 分配（一个用户可挂多个，管理员分配/收回）。
 */

export interface BadgeView {
  id: string;
  name: string;
  colorFrom: string;
  colorTo: string;
}

function mapBadge(row: typeof schema.badges.$inferSelect): BadgeView {
  return { id: row.id, name: row.name, colorFrom: row.color_from, colorTo: row.color_to };
}

export async function listBadges(db: Db): Promise<BadgeView[]> {
  const rows = await db
    .select()
    .from(schema.badges)
    .orderBy(schema.badges.created_at);
  return rows.map(mapBadge);
}

export async function createBadge(
  db: Db,
  input: { name: string; colorFrom?: string; colorTo?: string },
  createdBy: string,
): Promise<BadgeView> {
  const name = input.name.trim();
  if (!name) throw errors.validation({ issues: [{ path: 'name', message: '徽章文字不能为空' }] });
  if (name.length > 20) throw errors.validation({ issues: [{ path: 'name', message: '徽章文字不超过 20 字' }] });
  const colorFrom = input.colorFrom || '#ff9a3c';
  const colorTo = input.colorTo || '#e0522f';
  const [row] = await db
    .insert(schema.badges)
    .values({ name, color_from: colorFrom, color_to: colorTo, created_by: createdBy })
    .returning();
  if (!row) throw errors.internal(undefined, '徽章创建失败');
  return mapBadge(row);
}

export async function deleteBadge(db: Db, badgeId: string): Promise<void> {
  // user_badges 级联删除，不用手动清理。
  await db.delete(schema.badges).where(eq(schema.badges.id, badgeId));
}

export async function assignBadge(db: Db, userId: string, badgeId: string, assignedBy: string): Promise<void> {
  await db
    .insert(schema.userBadges)
    .values({ user_id: userId, badge_id: badgeId, assigned_by: assignedBy })
    .onConflictDoNothing();
}

export async function revokeBadge(db: Db, userId: string, badgeId: string): Promise<void> {
  await db
    .delete(schema.userBadges)
    .where(and(eq(schema.userBadges.user_id, userId), eq(schema.userBadges.badge_id, badgeId)));
}

/** 单个用户的徽章（个人主页）。 */
export async function listUserBadges(db: Db, userId: string): Promise<BadgeView[]> {
  const rows = await db
    .select({
      id: schema.badges.id,
      name: schema.badges.name,
      color_from: schema.badges.color_from,
      color_to: schema.badges.color_to,
    })
    .from(schema.userBadges)
    .innerJoin(schema.badges, eq(schema.userBadges.badge_id, schema.badges.id))
    .where(eq(schema.userBadges.user_id, userId))
    .orderBy(schema.userBadges.created_at);
  return rows.map((row) => ({ id: row.id, name: row.name, colorFrom: row.color_from, colorTo: row.color_to }));
}

/** 批量取多个用户的徽章（帖子列表/管理面板用）；没有徽章的用户不在 Map 里。 */
export async function listBadgesForUsers(db: Db, userIds: string[]): Promise<Map<string, BadgeView[]>> {
  const result = new Map<string, BadgeView[]>();
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return result;
  const rows = await db
    .select({
      user_id: schema.userBadges.user_id,
      id: schema.badges.id,
      name: schema.badges.name,
      color_from: schema.badges.color_from,
      color_to: schema.badges.color_to,
    })
    .from(schema.userBadges)
    .innerJoin(schema.badges, eq(schema.userBadges.badge_id, schema.badges.id))
    .where(inArray(schema.userBadges.user_id, unique))
    .orderBy(schema.userBadges.created_at);
  for (const row of rows) {
    const list = result.get(row.user_id) ?? [];
    list.push({ id: row.id, name: row.name, colorFrom: row.color_from, colorTo: row.color_to });
    result.set(row.user_id, list);
  }
  return result;
}