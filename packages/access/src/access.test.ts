import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import { errors } from '@ycomm/kernel';
import { PERMISSION } from '@ycomm/config';
import {
  assertCanActOnRole,
  assertCanViewResource,
  assertPermission,
  assertSubjectCanAct,
  canViewResource,
  grantAccess,
  type AccessSubject,
} from './index';

let handle: DatabaseHandle;
/** 真实存在的用户（access_grants/user FK 需要），每个用例前创建。 */
let subjectId = '';

beforeEach(async () => {
  const [row] = await handle.db
    .insert(schema.users)
    .values({
      username: 'u1',
      email: 'u1@example.com',
      password_hash: 'x',
      state: 'active',
      display_name: 'u1',
    })
    .returning({ id: schema.users.id });
  subjectId = row?.id ?? '';
});

function subject(overrides: Partial<AccessSubject> = {}): AccessSubject {
  return {
    id: subjectId,
    role: 'member',
    level: 1,
    state: 'active',
    mutedUntil: null,
    banReason: null,
    ...overrides,
  };
}

const PUBLIC_RESOURCE = { type: 'board' as const, id: randomUUID(), policy: { visibility: 'public' as const, minLevel: 0, requireInvite: false } };
const LOGIN_RESOURCE = { type: 'board' as const, id: randomUUID(), policy: { visibility: 'login' as const, minLevel: 0, requireInvite: false } };
const LEVEL_RESOURCE = { type: 'download_resource' as const, id: randomUUID(), policy: { visibility: 'login' as const, minLevel: 2, requireInvite: false } };
const INVITE_RESOURCE = { type: 'download_resource' as const, id: randomUUID(), policy: { visibility: 'login' as const, minLevel: 0, requireInvite: true } };

beforeAll(async () => {
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations');
  handle = await createInMemoryDb({ migrationsFolder });
  await handle.runMigrations();
});

afterEach(async () => {
  for (const table of [schema.accessGrants, schema.users]) {
    await handle.db.delete(table);
  }
  subjectId = '';
});

describe('① account state gate', () => {
  it('blocks banned and unverified, allows guests and active users', () => {
    expect(() => assertSubjectCanAct(subject({ state: 'banned', banReason: 'spam' }))).toThrow(
      errors.accountBanned('spam').message,
    );
    expect(() => assertSubjectCanAct(subject({ state: 'unverified' }))).toThrow(
      errors.accountUnverified().message,
    );
    expect(() => assertSubjectCanAct(null)).not.toThrow();
    expect(() => assertSubjectCanAct(subject())).not.toThrow();
    // The verification flow itself may skip the verified requirement.
    expect(() => assertSubjectCanAct(subject({ state: 'unverified' }), { requireVerified: false })).not.toThrow();
  });
});

describe('② resource policy gate', () => {
  it('guests see public resources only', async () => {
    expect(await canViewResource(handle.db, null, PUBLIC_RESOURCE)).toBe(true);
    expect(await canViewResource(handle.db, null, LOGIN_RESOURCE)).toBe(false);
    await expect(assertCanViewResource(handle.db, null, LOGIN_RESOURCE)).rejects.toMatchObject({
      code: errors.loginRequired().code,
    });
  });

  it('enforces level thresholds', async () => {
    await expect(assertCanViewResource(handle.db, subject({ level: 1 }), LEVEL_RESOURCE)).rejects.toMatchObject({
      code: errors.levelTooLow(2, 1).code,
    });
    await expect(assertCanViewResource(handle.db, subject({ level: 2 }), LEVEL_RESOURCE)).resolves.toBeUndefined();
  });

  it('invite-locked resources require a grant; staff override it', async () => {
    await expect(assertCanViewResource(handle.db, subject(), INVITE_RESOURCE)).rejects.toMatchObject({
      code: errors.inviteRequired().code,
    });

    await grantAccess(handle.db, {
      userId: subjectId,
      resourceType: 'download_resource',
      resourceId: INVITE_RESOURCE.id,
      via: 'invite_code',
    });
    await expect(assertCanViewResource(handle.db, subject(), INVITE_RESOURCE)).resolves.toBeUndefined();

    await handle.db.delete(schema.accessGrants);
    await expect(
      assertCanViewResource(handle.db, subject({ role: 'admin' }), INVITE_RESOURCE),
    ).resolves.toBeUndefined();
  });
});

describe('③ permission gate', () => {
  it('members may not delete others’ posts; owners may', () => {
    expect(() => assertPermission(subject(), PERMISSION.FORUM_POST_DELETE_ANY)).toThrow('权限不足');
    expect(() => assertPermission(subject({ role: 'owner' }), PERMISSION.FORUM_POST_DELETE_ANY)).not.toThrow();
    expect(() => assertPermission(null, PERMISSION.FORUM_TOPIC_CREATE)).toThrow(
      errors.loginRequired().message,
    );
  });
});

describe('rank gate', () => {
  it('claims strictly higher rank to act on another account', () => {
    expect(() => assertCanActOnRole(subject({ role: 'admin' }), 'member')).not.toThrow();
    expect(() => assertCanActOnRole(subject({ role: 'admin' }), 'admin')).toThrow();
    expect(() => assertCanActOnRole(subject({ role: 'owner' }), 'admin')).not.toThrow();
    expect(() => assertCanActOnRole(subject({ role: 'owner' }), 'owner')).toThrow();
  });
});