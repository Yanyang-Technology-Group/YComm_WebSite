import { asc, eq, isNull } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { canViewResource, type AccessSubject } from '@ycomm/access';
import { errors } from '@ycomm/kernel';
import { parseAccessPolicy, safeParseAccessPolicy, type AccessPolicy } from '@ycomm/config';

export type BoardRow = typeof schema.boards.$inferSelect;

export interface BoardView extends BoardRow {
  policy: AccessPolicy;
}

/** Visible boards for the subject, honoring each board's access policy. */
export async function listBoards(db: Db, subject: AccessSubject | null): Promise<BoardView[]> {
  const rows = await db
    .select()
    .from(schema.boards)
    .where(isNull(schema.boards.archived_at))
    .orderBy(asc(schema.boards.sort_order));

  const visible: BoardView[] = [];
  for (const row of rows) {
    const policy = safeParseAccessPolicy(row.access_policy);
    const allowed = await canViewResource(db, subject, { type: 'board', id: row.id, policy });
    if (allowed) {
      visible.push({ ...row, policy });
    }
  }
  return visible;
}

/** 管理用：列出全部版块（含已归档），不做访问策略过滤，按 sort_order 排序。 */
export async function listAllBoards(db: Db): Promise<BoardView[]> {
  const rows = await db.select().from(schema.boards).orderBy(asc(schema.boards.sort_order));
  return rows.map((row) => ({ ...row, policy: safeParseAccessPolicy(row.access_policy) }));
}

export async function getBoardBySlug(db: Db, slug: string): Promise<BoardView | null> {
  const rows = await db.select().from(schema.boards).where(eq(schema.boards.slug, slug)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, policy: safeParseAccessPolicy(row.access_policy) };
}

export async function getBoardById(db: Db, boardId: string): Promise<BoardView | null> {
  const rows = await db.select().from(schema.boards).where(eq(schema.boards.id, boardId)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, policy: safeParseAccessPolicy(row.access_policy) };
}

export interface CreateBoardInput {
  slug: string;
  name: string;
  description: string;
  parentId?: string | null;
  sortOrder?: number;
  policy?: AccessPolicy;
  /** 发帖权限：all=所有人 / staff=仅管理员与站长。 */
  postingPolicy?: 'all' | 'staff';
}

export async function createBoard(db: Db, input: CreateBoardInput): Promise<BoardRow> {
  if (!/^[a-z0-9-]{2,40}$/.test(input.slug)) {
    throw errors.validation({ issues: [{ path: 'slug', message: 'slug 仅限小写字母/数字/连字符' }] });
  }
  if (input.name.trim().length < 2 || input.name.trim().length > 60) {
    throw errors.validation({ issues: [{ path: 'name', message: '版块名称长度为 2-60' }] });
  }
  const [created] = await db
    .insert(schema.boards)
    .values({
      slug: input.slug,
      name: input.name.trim(),
      description: input.description.trim(),
      parent_id: input.parentId ?? null,
      sort_order: input.sortOrder ?? 100,
      access_policy: input.policy ?? parseAccessPolicy({}),
      posting_policy: input.postingPolicy ?? 'all',
    })
    .returning();
  if (!created) throw errors.internal(undefined, 'board insert failed');
  return created;
}

export async function updateBoard(
  db: Db,
  boardId: string,
  patch: {
    name?: string;
    description?: string;
    sortOrder?: number;
    policy?: AccessPolicy;
    postingPolicy?: 'all' | 'staff';
  },
): Promise<BoardRow> {
  const [updated] = await db
    .update(schema.boards)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.sortOrder !== undefined ? { sort_order: patch.sortOrder } : {}),
      ...(patch.policy !== undefined ? { access_policy: patch.policy } : {}),
      ...(patch.postingPolicy !== undefined ? { posting_policy: patch.postingPolicy } : {}),
      updated_at: new Date(),
    })
    .where(eq(schema.boards.id, boardId))
    .returning();
  if (!updated) throw errors.notFound('版块不存在');
  return updated;
}

/**
 * 发帖权限门：posting_policy='staff' 的版块只有管理员/站长能发主题和回帖。
 * 返回 true 表示允许；false 抛错。
 */
export function assertCanPostInBoard(subject: AccessSubject | null | undefined, board: BoardView): void {
  if (board.posting_policy !== 'staff') return;
  if (!subject || (subject.role !== 'admin' && subject.role !== 'owner')) {
    throw errors.forbidden('该版块仅站长/管理员可以发帖');
  }
}

export async function archiveBoard(db: Db, boardId: string): Promise<void> {
  await db.update(schema.boards).set({ archived_at: new Date() }).where(eq(schema.boards.id, boardId));
}

/** 把已归档的版块恢复上线（管理员误删救回）。 */
export async function restoreBoard(db: Db, boardId: string): Promise<void> {
  await db.update(schema.boards).set({ archived_at: null }).where(eq(schema.boards.id, boardId));
}