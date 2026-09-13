import { eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { validatePassword } from '@ycomm/config';
import { errors } from '@ycomm/kernel';
import { hashPassword, verifyPassword } from './password';
import { consumeInviteCode } from './invites';
import type { UserRecord } from './types';

export async function getUserById(db: Db, userId: string): Promise<UserRecord> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) throw errors.notFound('用户不存在');
  return user;
}

export interface UpdateProfileInput {
  displayName?: string;
  bio?: string;
  avatarPath?: string | null;
}

export async function updateProfile(db: Db, userId: string, input: UpdateProfileInput): Promise<UserRecord> {
  const [updated] = await db
    .update(schema.users)
    .set({
      ...(input.displayName !== undefined ? { display_name: input.displayName.trim().slice(0, 40) } : {}),
      ...(input.bio !== undefined ? { bio: input.bio.slice(0, 500) } : {}),
      ...(input.avatarPath !== undefined ? { avatar_path: input.avatarPath } : {}),
      updated_at: new Date(),
    })
    .where(eq(schema.users.id, userId))
    .returning();
  if (!updated) throw errors.notFound('用户不存在');
  return updated;
}

export async function changePassword(db: Db, userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const passwordIssue = validatePassword(newPassword);
  if (passwordIssue) {
    throw errors.validation({ issues: [{ path: 'newPassword', message: passwordIssue }] });
  }
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) throw errors.notFound('用户不存在');
  const ok = user.password_hash ? await verifyPassword(user.password_hash, currentPassword) : false;
  if (!ok) {
    throw errors.validation({ issues: [{ path: 'currentPassword', message: '当前密码不正确' }] });
  }
  const hash = await hashPassword(newPassword);
  await db.update(schema.users).set({ password_hash: hash, updated_at: new Date() }).where(eq(schema.users.id, userId));
}

export async function changeEmail(db: Db, userId: string, newEmail: string): Promise<void> {
  const email = newEmail.trim().toLowerCase();
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(sql`lower(${schema.users.email})`, email))
    .limit(1);
  if (existing && existing.id !== userId) throw errors.conflict('该邮箱已被使用');
  await db.update(schema.users).set({ email: newEmail.trim(), updated_at: new Date() }).where(eq(schema.users.id, userId));
}

export async function bindInviteCode(db: Db, userId: string, code: string): Promise<{ codeId: string }> {
  const [existing] = await db
    .select({ id: schema.inviteCodeUses.id })
    .from(schema.inviteCodeUses)
    .where(eq(schema.inviteCodeUses.user_id, userId))
    .limit(1);
  if (existing) throw errors.conflict('已绑定注册码，不可更改');
  const claimed = await consumeInviteCode(db, code.trim(), userId);
  if (!claimed) throw errors.validation({ issues: [{ path: 'code', message: '注册码无效、已用完或已过期' }] });
  return { codeId: claimed.codeId };
}

export interface InviteBindingView {
  bound: boolean;
  code: string | null;
}

export async function getInviteBinding(db: Db, userId: string): Promise<InviteBindingView> {
  const rows = await db
    .select({ code: schema.inviteCodes.code })
    .from(schema.inviteCodeUses)
    .innerJoin(schema.inviteCodes, eq(schema.inviteCodeUses.invite_code_id, schema.inviteCodes.id))
    .where(eq(schema.inviteCodeUses.user_id, userId))
    .limit(1);
  const row = rows[0];
  return { bound: row != null, code: row?.code ?? null };
}
