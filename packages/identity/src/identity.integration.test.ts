import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import { AUTH } from '@ycomm/config';
import { errors } from '@ycomm/kernel';
import {
  adminCreateInviteCode,
  assertAccountCanAct,
  banUser,
  createInviteCode,
  createSession,
  deleteAccountNow,
  deleteInviteCode,
  expireSanctions,
  findSessionByToken,
  hashPassword,
  listInviteCodes,
  listUsers,
  muteUser,
  register,
  requestAccountDeletion,
  requestPasswordReset,
  resetPassword,
  revokeAllSessionsForUser,
  revokeSession,
  toPublicUser,
  unbanUser,
  unmuteUser,
  verifyEmail,
  verifyPassword,
  type UserRecord,
} from '@ycomm/identity';

/**
 * P1 integration suite — runs against a real embedded Postgres (PGlite).
 * Hermetic: every test gets a fresh in-memory database with migrations applied.
 */

interface MailJobPayload {
  to?: string;
  template?: string;
  html?: string;
  text?: string;
}

let handle: DatabaseHandle;

beforeAll(async () => {
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'db',
    'migrations',
  );
  handle = await createInMemoryDb({ migrationsFolder });
  await handle.runMigrations();
});

afterEach(async () => {
  for (const table of [
    schema.postRevisions,
    schema.posts,
    schema.topics,
    schema.boards,
    schema.downloadLogs,
    schema.downloadReports,
    schema.downloadLinks,
    schema.downloadResources,
    schema.downloadCategories,
    schema.moderationActions,
    schema.moderationItems,
    schema.userSanctions,
    schema.reactions,
    schema.notifications,
    schema.emailLogs,
    schema.jobs,
    schema.auditLogs,
    schema.emailTokens,
    schema.sessions,
    schema.inviteCodeUses,
    schema.inviteCodes,
    schema.oauthAccounts,
    schema.accessGrants,
    schema.settings,
    schema.users,
  ]) {
    await handle.db.delete(table);
  }
});

async function seedOwner(): Promise<string> {
  const [row] = await handle.db
    .insert(schema.users)
    .values({
      username: 'owner',
      email: 'owner@example.com',
      password_hash: await hashPassword('owner-password-1'),
      role: 'owner',
      state: 'active',
      display_name: 'owner',
      level: 4,
    })
    .returning({ id: schema.users.id });
  return row?.id ?? '';
}

/** Pull the raw one-time token out of the queued mail (it's only ever mailed). */
async function rawTokenFromMail(kind: 'verify_email' | 'password_reset'): Promise<string> {
  const mails = await handle.db.select().from(schema.jobs).where(eq(schema.jobs.kind, 'send_email'));
  const payload = mails.map((mail) => mail.payload as MailJobPayload).find(
    (mail) => mail.template === kind,
  );
  const html = payload?.html ?? payload?.text ?? '';
  const match = html.match(/token=([^&"<>\s]+)/);
  if (!match?.[1]) throw new Error(`no ${kind} token found in queued mail`);
  return match[1];
}

const NEW_USER = { username: 'alice', email: 'alice@example.com', password: 'Secret-12345' };

describe('register', () => {
  it('rejects registration before the site has an owner', async () => {
    await expect(register(handle.db, NEW_USER)).rejects.toMatchObject({
      code: errors.siteNotInitialized().code,
    });
  });

  it('creates an unverified member and queues a verification mail', async () => {
    await seedOwner();
    const result = await register(handle.db, NEW_USER);
    expect(result.alreadyRegistered).toBe(false);
    expect(result.needsVerification).toBe(true);
    expect(result.user.state).toBe('unverified');
    expect(result.user.role).toBe('member');

    const tokens = await handle.db
      .select()
      .from(schema.emailTokens)
      .where(eq(schema.emailTokens.purpose, 'verify_email'));
    expect(tokens).toHaveLength(1);

    const mails = await handle.db.select().from(schema.jobs).where(eq(schema.jobs.kind, 'send_email'));
    expect(mails.length).toBeGreaterThanOrEqual(1);
  });

  it('username collisions are CONFLICT, email collisions are indistinguishable from success', async () => {
    await seedOwner();
    await register(handle.db, NEW_USER);

    await expect(register(handle.db, { ...NEW_USER, email: 'other@example.com' })).rejects.toMatchObject(
      { code: errors.conflict().code },
    );

    const dup = await register(handle.db, { ...NEW_USER, username: 'bob' });
    expect(dup.alreadyRegistered).toBe(true);
  });

  it('enforces the username pattern and reserved names', async () => {
    await seedOwner();
    await expect(register(handle.db, { ...NEW_USER, username: 'ab' })).rejects.toMatchObject({
      code: errors.validation().code,
    });
    await expect(register(handle.db, { ...NEW_USER, username: 'admin' })).rejects.toMatchObject({
      code: errors.conflict().code,
    });
  });

  it('注销后可以用同样的用户名和邮箱重新注册', async () => {
    await seedOwner();
    const first = await register(handle.db, NEW_USER);

    await deleteAccountNow(handle.db, first.user.id);

    // 旧行保留（审计/帖子作者仍引用），但用户名/邮箱已经释放并匿名化。
    const [old] = await handle.db.select().from(schema.users).where(eq(schema.users.id, first.user.id));
    expect(old?.state).toBe('deleted');
    expect(old?.username).not.toBe(NEW_USER.username);
    expect(old?.email).not.toBe(NEW_USER.email);
    expect(old?.display_name).toBe('已注销用户');

    // 同名同邮箱再次注册：应当真的建号，而不是「邮箱已存在」的假成功。
    const second = await register(handle.db, NEW_USER);
    expect(second.alreadyRegistered).toBe(false);
    expect(second.user.id).not.toBe(first.user.id);
    expect(second.user.username).toBe(NEW_USER.username);
    expect(second.user.email).toBe(NEW_USER.email);
  });

  it('封禁 / 禁言期间不能申请注销账号', async () => {    const ownerId = await seedOwner();
    const [target] = await handle.db
      .insert(schema.users)
      .values({
        username: 'sanctioned',
        email: 'sanctioned@example.com',
        password_hash: 'x',
        state: 'active',
        display_name: 'sanctioned',
      })
      .returning();
    if (!target) throw new Error('no user');

    await banUser(handle.db, { id: ownerId, role: 'owner' }, target.id, { reason: 'spam' });
    await expect(requestAccountDeletion(handle.db, target.id)).rejects.toMatchObject({
      code: errors.forbidden().code,
    });

    await unbanUser(handle.db, { id: ownerId, role: 'owner' }, target.id);
    await muteUser(handle.db, { id: ownerId, role: 'owner' }, target.id, {
      until: null,
      reason: 'flood',
    });
    await expect(requestAccountDeletion(handle.db, target.id)).rejects.toMatchObject({
      code: errors.forbidden().code,
    });

    // 解除处罚后恢复正常（请求注销 = 排一封确认邮件）。
    await unmuteUser(handle.db, { id: ownerId, role: 'owner' }, target.id);
    await expect(requestAccountDeletion(handle.db, target.id)).resolves.toBeUndefined();
  });

  it('冷静期已过但没人登录的 deleting 账号，也要让出用户名/邮箱', async () => {
    await seedOwner();
    // 直接造一个「冷静期早就过了」的账号（现实中是确认注销后一直没再登录）。
    const expiredAt = new Date(Date.now() - (AUTH.accountDeletionGraceDays + 1) * 86400_000);
    await handle.db.insert(schema.users).values({
      username: 'ghost',
      email: 'ghost@example.com',
      password_hash: 'x',
      state: 'deleting',
      deleted_at: expiredAt,
      display_name: 'ghost',
    });

    const again = await register(handle.db, {
      username: 'ghost',
      email: 'ghost@example.com',
      password: 'Secret-12345',
    });
    expect(again.alreadyRegistered).toBe(false);
    expect(again.user.username).toBe('ghost');

    // 老账号被转成永久注销并匿名化；新账号拿到原来的用户名/邮箱。
    const rows = await handle.db.select().from(schema.users);
    const ghosts = rows.filter((row) => row.username === 'ghost');
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]?.email).toBe('ghost@example.com');
    expect(ghosts[0]?.state).toBe('unverified');
    const released = rows.filter((row) => row.state === 'deleted' && row.display_name === '已注销用户');
    expect(released).toHaveLength(1);
    expect(released[0]?.username).not.toBe('ghost');
    expect(released[0]?.email).not.toBe('ghost@example.com');
  });

  it('invite codes are consumed exactly once when max_uses=1 under concurrency', async () => {
    const ownerId = await seedOwner();
    const code = await createInviteCode(handle.db, { createdBy: ownerId, maxUses: 1 });

    const attempts = await Promise.allSettled(
      [0, 1, 2, 3, 4].map((index) =>
        register(handle.db, {
          username: `race${index}`,
          email: `race${index}@example.com`,
          password: 'Secret-12345',
          inviteCode: code,
        }),
      ),
    );

    const fulfilled = attempts.filter((result) => result.status === 'fulfilled');
    const rejected = attempts.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected.length).toBeGreaterThanOrEqual(4);

    const codeRow = await handle.db
      .select({ used_count: schema.inviteCodes.used_count })
      .from(schema.inviteCodes)
      .where(eq(schema.inviteCodes.code, code));
    expect(codeRow[0]?.used_count).toBe(1);

    const winner = fulfilled[0] as { value: Awaited<ReturnType<typeof register>> };
    const winnerRow = await handle.db
      .select({ invited_by: schema.users.invited_by })
      .from(schema.users)
      .where(eq(schema.users.id, winner.value.user.id));
    expect(winnerRow[0]?.invited_by).toBe(ownerId);
  });
});

describe('verification', () => {
  it('moves the account to active and makes the token single-use', async () => {
    await seedOwner();
    const { user } = await register(handle.db, NEW_USER);
    const rawToken = await rawTokenFromMail('verify_email');

    const verified = await verifyEmail(handle.db, rawToken);
    expect(verified.id).toBe(user.id);
    expect(verified.state).toBe('active');

    await expect(verifyEmail(handle.db, rawToken)).rejects.toMatchObject({
      code: errors.validation().code,
    });
  });
});

describe('password hashing', () => {
  it('round-trips and rejects wrong passwords', async () => {
    const hashed = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(hashed, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hashed, 'wrong')).toBe(false);
  });
});

describe('sessions', () => {
  async function makeUser(username: string): Promise<UserRecord> {
    const [inserted] = await handle.db
      .insert(schema.users)
      .values({
        username,
        email: `${username}@example.com`,
        password_hash: await hashPassword('password-1'),
        state: 'active',
        display_name: username,
      })
      .returning();
    if (!inserted) throw new Error('no user inserted');
    return inserted as UserRecord;
  }

  it('create → find → revoke lifecycle', async () => {
    const user = await makeUser('session-test');
    const { rawToken } = await createSession(handle.db, { userId: user.id });
    const found = await findSessionByToken(handle.db, rawToken);
    expect(found).not.toBeNull();
    expect(found?.user.id).toBe(user.id);

    await revokeSession(handle.db, rawToken);
    expect(await findSessionByToken(handle.db, rawToken)).toBeNull();
  });

  it('revokeAllSessionsForUser kills everything for a password change', async () => {
    const user = await makeUser('session-test-2');
    const first = await createSession(handle.db, { userId: user.id });
    const second = await createSession(handle.db, { userId: user.id });
    await revokeAllSessionsForUser(handle.db, user.id);

    expect(await findSessionByToken(handle.db, first.rawToken)).toBeNull();
    expect(await findSessionByToken(handle.db, second.rawToken)).toBeNull();
  });
});

describe('password reset', () => {
  it('revokes sessions and keeps the reset token one-time', async () => {
    await seedOwner();
    const { user } = await register(handle.db, NEW_USER);
    const session = await createSession(handle.db, { userId: user.id });

    await requestPasswordReset(handle.db, NEW_USER.email);
    const rawToken = await rawTokenFromMail('password_reset');

    await resetPassword(handle.db, rawToken, 'New-Password-123');
    expect(await findSessionByToken(handle.db, session.rawToken)).toBeNull();

    await expect(resetPassword(handle.db, rawToken, 'Another-Password-1')).rejects.toMatchObject({
      code: errors.validation().code,
    });
  });
});

describe('admin invite codes', () => {
  it('creates, lists and deletes invite codes with a 10-character limit', async () => {
    const ownerId = await seedOwner();

    const created = await adminCreateInviteCode(handle.db, {
      name: '技术群 9 月码',
      code: 'TECH0901',
      createdBy: ownerId,
    });
    expect(created.code).toBe('TECH0901');
    expect(created.name).toBe('技术群 9 月码');

    // 11 位 → 拒绝
    await expect(
      adminCreateInviteCode(handle.db, { name: '超长码', code: 'ABCDEFGHIJK', createdBy: ownerId }),
    ).rejects.toMatchObject({ code: errors.validation().code });

    // 非法字符 → 拒绝
    await expect(
      adminCreateInviteCode(handle.db, { name: '非法码', code: '中文码12', createdBy: ownerId }),
    ).rejects.toMatchObject({ code: errors.validation().code });

    // 自动生成
    const auto = await adminCreateInviteCode(handle.db, { name: '自动生成', createdBy: ownerId });
    expect(auto.code.length).toBeLessThanOrEqual(10);

    const all = await listInviteCodes(handle.db);
    expect(all.length).toBe(2);

    await deleteInviteCode(handle.db, created.id);
    expect((await listInviteCodes(handle.db)).length).toBe(1);

    await expect(deleteInviteCode(handle.db, created.id)).rejects.toMatchObject({
      code: errors.notFound().code,
    });
  });
});

describe('account gates', () => {
  it('assertAccountCanAct blocks banned and unverified accounts', async () => {
    const [banned] = await handle.db
      .insert(schema.users)
      .values({
        username: 'banned-user',
        email: 'banned@example.com',
        password_hash: 'x',
        state: 'banned',
        display_name: 'banned-user',
      })
      .returning();
    if (!banned) throw new Error('no user');
    expect(() => assertAccountCanAct(banned as UserRecord)).toThrow(
      errors.accountBanned(null).message,
    );

    const [unverified] = await handle.db
      .insert(schema.users)
      .values({
        username: 'unverified-user',
        email: 'unverified@example.com',
        password_hash: 'x',
        state: 'unverified',
        display_name: 'unverified-user',
      })
      .returning();
    if (!unverified) throw new Error('no user');
    expect(() => assertAccountCanAct(unverified as UserRecord)).toThrow(
      errors.accountUnverified().message,
    );
    expect(() => assertAccountCanAct(unverified as UserRecord, { requireVerified: false })).not.toThrow();
  });

  it('toPublicUser never leaks credentials or the real email', async () => {
    const [user] = await handle.db
      .insert(schema.users)
      .values({
        username: 'public-view',
        email: 'public-view@example.com',
        password_hash: 'not-a-real-hash',
        state: 'active',
        display_name: 'Public',
      })
      .returning();
    if (!user) throw new Error('no user');
    const view = toPublicUser(user as UserRecord);
    expect(view).not.toHaveProperty('email');
    expect(view).not.toHaveProperty('password_hash');
    expect(view.username).toBe('public-view');
    expect(view.hasPassword).toBe(true);
  });

  it('expireSanctions lifts a timed ban once it is over', async () => {
    const ownerId = await seedOwner();
    const [target] = await handle.db
      .insert(schema.users)
      .values({
        username: 'timed-ban',
        email: 'timed-ban@example.com',
        password_hash: 'x',
        state: 'active',
        display_name: 'timed-ban',
      })
      .returning();
    if (!target) throw new Error('no user');

    // 未来 1 小时封禁：仍然拦截。
    const stillBanned = await banUser(
      handle.db,
      { id: ownerId, role: 'owner' },
      target.id,
      { reason: '限时封禁', until: new Date(Date.now() + 3_600_000) },
    );
    expect(stillBanned.state).toBe('banned');
    expect(stillBanned.banned_until).not.toBeNull();
    expect(await expireSanctions(handle.db, stillBanned)).toMatchObject({ state: 'banned' });

    // 已过期封禁：解析会话时自动解除。
    const expired = await banUser(
      handle.db,
      { id: ownerId, role: 'owner' },
      target.id,
      { reason: '限时封禁', until: new Date(Date.now() - 1000) },
    );
    const lifted = await expireSanctions(handle.db, expired);
    expect(lifted.state).toBe('active');
    expect(lifted.banned_until).toBeNull();
    expect(lifted.ban_reason).toBeNull();

    // 永久封禁（until = null）不会被解除。
    const permanent = await banUser(handle.db, { id: ownerId, role: 'owner' }, target.id, {
      reason: '永久封禁',
      until: null,
    });
    expect(permanent.banned_until).toBeNull();
    expect((await expireSanctions(handle.db, permanent)).state).toBe('banned');
  });

  it('注销后的账号从用户列表消失，但仍留在库里', async () => {
    await seedOwner();
    const [doomed] = await handle.db
      .insert(schema.users)
      .values({
        username: 'doomed',
        email: 'doomed@example.com',
        password_hash: 'x',
        state: 'active',
        display_name: 'doomed',
      })
      .returning();
    if (!doomed) throw new Error('no user');

    const before = await listUsers(handle.db, {});
    expect(before.users.map((user) => user.id)).toContain(doomed.id);

    await deleteAccountNow(handle.db, doomed.id);

    const after = await listUsers(handle.db, {});
    expect(after.users.map((user) => user.id)).not.toContain(doomed.id);
    expect(after.total).toBe(before.total - 1);

    // 数据仍在（审计/追溯需要），只是 state 变成 deleted。
    const [row] = await handle.db.select().from(schema.users).where(eq(schema.users.id, doomed.id));
    expect(row?.state).toBe('deleted');
  });
});