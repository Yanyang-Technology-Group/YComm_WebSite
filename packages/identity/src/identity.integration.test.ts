import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import {
  adminCreateInviteCode,
  assertAccountCanAct,
  createInviteCode,
  createSession,
  deleteInviteCode,
  findSessionByToken,
  hashPassword,
  listInviteCodes,
  register,
  requestPasswordReset,
  resetPassword,
  revokeAllSessionsForUser,
  revokeSession,
  toPublicUser,
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

const NEW_USER = { username: 'alice', email: 'alice@example.com', password: 'secret-12345' };

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

  it('invite codes are consumed exactly once when max_uses=1 under concurrency', async () => {
    const ownerId = await seedOwner();
    const code = await createInviteCode(handle.db, { createdBy: ownerId, maxUses: 1 });

    const attempts = await Promise.allSettled(
      [0, 1, 2, 3, 4].map((index) =>
        register(handle.db, {
          username: `race${index}`,
          email: `race${index}@example.com`,
          password: 'secret-12345',
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

    await resetPassword(handle.db, rawToken, 'new-password-123');
    expect(await findSessionByToken(handle.db, session.rawToken)).toBeNull();

    await expect(resetPassword(handle.db, rawToken, 'another-password-1')).rejects.toMatchObject({
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
  });
});