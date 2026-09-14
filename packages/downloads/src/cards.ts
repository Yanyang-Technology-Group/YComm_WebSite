import { and, asc, eq, isNull } from 'drizzle-orm';
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
      and(
        eq(schema.downloadCards.status, 'approved'),
        parentId === null
          ? isNull(schema.downloadCards.parent_id)
          : eq(schema.downloadCards.parent_id, parentId),
      ),
    )
    .orderBy(asc(schema.downloadCards.position), asc(schema.downloadCards.created_at));
  const inviteBound = subject ? await hasInviteBinding(db, subject.id) : false;
  return rows.filter((row) => canSee(subject, row.visibility, inviteBound));
}

/** 全部卡片（不做可见性/审核过滤，供后台编辑用）。 */
export async function listAllCards(db: Db): Promise<CardRow[]> {
  return db
    .select()
    .from(schema.downloadCards)
    .orderBy(asc(schema.downloadCards.position), asc(schema.downloadCards.created_at));
}

/**
 * 所有已通过审核、可见层级的卡片（扁平列表）。
 *
 * 卡片可以无限套娃，所以前台必须能一次拿到整棵树——按 `parentId` 自行组层级；
 * 只返回根层会让「进入子卡片」永远显示为空。
 */
export async function listVisibleCards(
  db: Db,
  subject: AccessSubject | null,
): Promise<CardRow[]> {
  const rows = await listAllCards(db);
  const visible = rows.filter((row) => row.status === 'approved');
  const inviteBound = subject ? await hasInviteBinding(db, subject.id) : false;
  return visible.filter((row) => canSee(subject, row.visibility, inviteBound));
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
  /** 简介里附带的文字跳转链接（直达地址）。 */
  subtitleUrl?: string | null;
}

export async function createCard(
  db: Db,
  input: CreateCardInput,
  createdByRole?: 'member' | 'admin' | 'owner',
): Promise<CardRow> {
  // 下载卡片要 owner 审核：owner 建的直接通过，管理员建的进待审核。
  const status = createdByRole === 'owner' ? 'approved' : 'pending';
  const [created] = await db
    .insert(schema.downloadCards)
    .values({
      parent_id: input.parentId,
      title: input.title.trim(),
      subtitle: input.subtitle ?? '',
      subtitle_url: input.subtitleUrl ?? null,
      kind: input.kind,
      redirect_url: input.redirectUrl ?? null,
      w: input.w ?? 1,
      h: input.h ?? 1,
      visibility: input.visibility ?? 'public',
      position: input.position ?? 0,
      status,
    })
    .returning();
  if (!created) throw errors.internal(undefined, '卡片创建失败');
  return created;
}

export interface UpdateCardInput {
  parentId?: string | null;
  title?: string;
  subtitle?: string;
  subtitleUrl?: string | null;
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
      ...(patch.subtitleUrl !== undefined ? { subtitle_url: patch.subtitleUrl } : {}),
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

export type CardReviewDecision = 'approve' | 'reject';

/** 站长审核卡片：approve → 公开可见；reject → 保持不可见。仅 owner 可调用。 */
export async function reviewCard(
  db: Db,
  cardId: string,
  decision: CardReviewDecision,
): Promise<CardRow> {
  const status = decision === 'approve' ? 'approved' : 'rejected';
  const [updated] = await db
    .update(schema.downloadCards)
    .set({ status, updated_at: new Date() })
    .where(eq(schema.downloadCards.id, cardId))
    .returning();
  if (!updated) throw errors.notFound('卡片不存在');
  return updated;
}
