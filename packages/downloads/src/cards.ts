import { asc, eq, isNull } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import type { AccessSubject } from '@ycomm/access';

export type CardRow = typeof schema.downloadCards.$inferSelect;
export type CardKind = CardRow['kind'];
export type CardVisibility = 'public' | 'login' | 'invite' | 'staff';

/**
 * 卡片可见性：
 * - public 访客可见
 * - login  需要登录
 * - invite 需要账号绑定过注册码（站长/管理员不受限）
 * - staff  仅管理员/站长
 */
function canSee(
  subject: AccessSubject | null,
  visibility: string,
  inviteBound: boolean,
): boolean {
  if (visibility === 'public') return true;
  if (!subject) return false;
  const staff = subject.role === 'admin' || subject.role === 'owner';
  if (visibility === 'staff') return staff;
  if (visibility === 'invite') return staff || inviteBound;
  if (visibility === 'login') return true;
  return false;
}

/** 该账号是否绑定/兑换过注册码（绑定后才能看到「需注册码」的卡片）。 */
async function hasInviteBinding(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.inviteCodeUses.id })
    .from(schema.inviteCodeUses)
    .where(eq(schema.inviteCodeUses.user_id, userId))
    .limit(1);
  return rows.length > 0;
}

/** 某层级（parentId 为 null 表示根层）下按可见性过滤后的卡片列表。 */
export async function listCards(
  db: Db,
  subject: AccessSubject | null,
  parentId: string | null = null,
): Promise<CardRow[]> {
  const rows = await db
    .select()
    .from(schema.downloadCards)
    .where(
      parentId === null
        ? isNull(schema.downloadCards.parent_id)
        : eq(schema.downloadCards.parent_id, parentId),
    )
    .orderBy(asc(schema.downloadCards.position), asc(schema.downloadCards.created_at));
  const inviteBound = subject ? await hasInviteBinding(db, subject.id) : false;
  return rows.filter((row) => canSee(subject, row.visibility, inviteBound));
}

/** 全部卡片（不做可见性过滤，供后台编辑用）。 */
export async function listAllCards(db: Db): Promise<CardRow[]> {
  return db
    .select()
    .from(schema.downloadCards)
    .orderBy(asc(schema.downloadCards.position), asc(schema.downloadCards.created_at));
}

/**
 * 所有可见层级的卡片（扁平列表）。
 *
 * 卡片可以无限套娃，所以前台必须能一次拿到整棵树——按 `parentId` 自行组层级；
 * 只返回根层会让「进入子卡片」永远显示为空。
 */
export async function listVisibleCards(
  db: Db,
  subject: AccessSubject | null,
): Promise<CardRow[]> {
  const rows = await listAllCards(db);
  const inviteBound = subject ? await hasInviteBinding(db, subject.id) : false;
  return rows.filter((row) => canSee(subject, row.visibility, inviteBound));
}

export async function getCard(db: Db, cardId: string): Promise<CardRow | null> {
  const rows = await db
    .select()
    .from(schema.downloadCards)
    .where(eq(schema.downloadCards.id, cardId))
    .limit(1);
  return rows[0] ?? null;
}

export interface CreateCardInput {
  parentId: string | null;
  title: string;
  subtitle?: string;
  kind: CardKind;
  redirectUrl?: string | null;
  w?: number;
  h?: number;
  visibility?: CardVisibility;
  position?: number;
}

export async function createCard(db: Db, input: CreateCardInput): Promise<CardRow> {
  const [created] = await db
    .insert(schema.downloadCards)
    .values({
      parent_id: input.parentId,
      title: input.title.trim(),
      subtitle: input.subtitle ?? '',
      kind: input.kind,
      redirect_url: input.redirectUrl ?? null,
      w: input.w ?? 1,
      h: input.h ?? 1,
      visibility: input.visibility ?? 'public',
      position: input.position ?? 0,
    })
    .returning();
  if (!created) throw errors.internal(undefined, '卡片创建失败');
  return created;
}

export interface UpdateCardInput {
  parentId?: string | null;
  title?: string;
  subtitle?: string;
  kind?: CardKind;
  redirectUrl?: string | null;
  w?: number;
  h?: number;
  visibility?: CardVisibility;
  position?: number;
}

export async function updateCard(db: Db, cardId: string, patch: UpdateCardInput): Promise<CardRow> {
  const [updated] = await db
    .update(schema.downloadCards)
    .set({
      ...(patch.parentId !== undefined ? { parent_id: patch.parentId } : {}),
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.subtitle !== undefined ? { subtitle: patch.subtitle } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.redirectUrl !== undefined ? { redirect_url: patch.redirectUrl } : {}),
      ...(patch.w !== undefined ? { w: patch.w } : {}),
      ...(patch.h !== undefined ? { h: patch.h } : {}),
      ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
      ...(patch.position !== undefined ? { position: patch.position } : {}),
      updated_at: new Date(),
    })
    .where(eq(schema.downloadCards.id, cardId))
    .returning();
  if (!updated) throw errors.notFound('卡片不存在');
  return updated;
}

export async function deleteCard(db: Db, cardId: string): Promise<void> {
  await db.delete(schema.downloadCards).where(eq(schema.downloadCards.id, cardId));
}
