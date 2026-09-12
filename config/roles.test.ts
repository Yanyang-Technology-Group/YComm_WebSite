import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  canActOnUser,
  canAssignRole,
  GUEST_PERMISSIONS,
  OWNER_ONLY_PERMISSIONS,
  PERMISSION,
  PERMISSION_DEFINITIONS,
  roleHasPermission,
  ROLE_PERMISSIONS,
  type Permission,
  type SubjectRole,
} from './roles';

describe('permission catalogue integrity', () => {
  it('declares every permission point exactly once in the definitions', () => {
    const defined = new Set(PERMISSION_DEFINITIONS.map((definition) => definition.id));
    expect(defined.size).toBe(PERMISSION_DEFINITIONS.length);
    for (const permission of ALL_PERMISSIONS) {
      expect(defined.has(permission), `missing definition for ${permission}`).toBe(true);
    }
    expect(defined.size).toBe(ALL_PERMISSIONS.length);
  });

  it('marks exactly the dangerous capability set as owner-only', () => {
    const expected = PERMISSION_DEFINITIONS.filter(
      (definition) => definition.ownerOnly === true,
    ).map((definition) => definition.id);
    expect([...OWNER_ONLY_PERMISSIONS].sort()).toEqual([...expected].sort());
  });
});

describe('guest', () => {
  it('can only view boards', () => {
    for (const permission of GUEST_PERMISSIONS) {
      expect(permission).toBe(PERMISSION.FORUM_BOARD_VIEW);
    }
    expect(roleHasPermission('guest', PERMISSION.FORUM_TOPIC_CREATE)).toBe(false);
    expect(roleHasPermission('guest', PERMISSION.DOWNLOAD_FILE_FETCH)).toBe(false);
  });
});

describe('permission matrix', () => {
  const G: SubjectRole = 'guest';
  const M: SubjectRole = 'member';
  const A: SubjectRole = 'admin';
  const O: SubjectRole = 'owner';

  it('members may create and edit their own content but never touch others\'', () => {
    expect(roleHasPermission(M, PERMISSION.FORUM_TOPIC_CREATE)).toBe(true);
    expect(roleHasPermission(M, PERMISSION.FORUM_POST_CREATE)).toBe(true);
    expect(roleHasPermission(M, PERMISSION.FORUM_POST_EDIT_OWN)).toBe(true);
    expect(roleHasPermission(M, PERMISSION.FORUM_POST_DELETE_OWN)).toBe(true);
    expect(roleHasPermission(M, PERMISSION.FORUM_POST_DELETE_ANY)).toBe(false);
    expect(roleHasPermission(M, PERMISSION.FORUM_BOARD_MANAGE)).toBe(false);
  });

  it('members can fetch gated downloads but not publish resources', () => {
    expect(roleHasPermission(M, PERMISSION.DOWNLOAD_RESOURCE_VIEW)).toBe(true);
    expect(roleHasPermission(M, PERMISSION.DOWNLOAD_FILE_FETCH)).toBe(true);
    expect(roleHasPermission(M, PERMISSION.DOWNLOAD_RESOURCE_CREATE)).toBe(false);
    expect(roleHasPermission(M, PERMISSION.DOWNLOAD_RESOURCE_AUDIT)).toBe(false);
  });

  it('members cannot act on other users', () => {
    for (const permission of [
      PERMISSION.USER_WARN,
      PERMISSION.USER_MUTE,
      PERMISSION.USER_BAN,
      PERMISSION.USER_ROLE_ASSIGN,
      PERMISSION.REPORT_HANDLE,
    ]) {
      expect(roleHasPermission(M, permission)).toBe(false);
    }
  });

  it('admins get every moderation capability except the owner-only set', () => {
    for (const permission of ADMIN_EXPECTED) {
      expect(roleHasPermission(A, permission), `admin should hold ${permission}`).toBe(true);
    }
    for (const permission of OWNER_ONLY_PERMISSIONS) {
      expect(roleHasPermission(A, permission), `admin must NOT hold ${permission}`).toBe(false);
    }
    expect(roleHasPermission(A, PERMISSION.FORUM_POST_DELETE_ANY)).toBe(true);
    expect(roleHasPermission(A, PERMISSION.USER_BAN)).toBe(true);
    expect(roleHasPermission(A, PERMISSION.DOWNLOAD_RESOURCE_CREATE)).toBe(true);
  });

  it('admins upload needs owner review because only the owner audits resources', () => {
    expect(roleHasPermission(A, PERMISSION.DOWNLOAD_RESOURCE_AUDIT)).toBe(false);
    expect(roleHasPermission(O, PERMISSION.DOWNLOAD_RESOURCE_AUDIT)).toBe(true);
  });

  it('the owner holds every permission point', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(roleHasPermission(O, permission)).toBe(true);
    }
  });

  it('each role is a strict subset of the next higher one', () => {
    for (const permission of GUEST_PERMISSIONS) {
      expect(roleHasPermission(M, permission)).toBe(true);
      expect(roleHasPermission(A, permission)).toBe(true);
      expect(roleHasPermission(O, permission)).toBe(true);
    }
    for (const permission of ROLE_PERMISSIONS.member) {
      expect(roleHasPermission(A, permission)).toBe(true);
      expect(roleHasPermission(O, permission)).toBe(true);
    }
    for (const permission of ROLE_PERMISSIONS.admin) {
      expect(roleHasPermission(O, permission)).toBe(true);
    }
  });

  it('guests never hold member+ capabilities', () => {
    for (const permission of ROLE_PERMISSIONS.member) {
      if (permission === PERMISSION.FORUM_BOARD_VIEW) continue;
      expect(roleHasPermission(G, permission)).toBe(false);
    }
  });
});

describe('anti-escalation rules', () => {
  it('only the owner can assign roles, and never the owner role itself', () => {
    expect(canAssignRole('owner', 'member')).toBe(true);
    expect(canAssignRole('owner', 'admin')).toBe(true);
    expect(canAssignRole('owner', 'owner')).toBe(false); // role path; transfer is separate
    expect(canAssignRole('admin', 'member')).toBe(false);
    expect(canAssignRole('admin', 'admin')).toBe(false);
    expect(canAssignRole('member', 'member')).toBe(false);
  });

  it('operators can only act on strictly lower-ranked accounts', () => {
    expect(canActOnUser('admin', 'member')).toBe(true);
    expect(canActOnUser('admin', 'guest')).toBe(true);
    expect(canActOnUser('admin', 'admin')).toBe(false);
    expect(canActOnUser('admin', 'owner')).toBe(false);
    expect(canActOnUser('owner', 'admin')).toBe(true);
    expect(canActOnUser('owner', 'owner')).toBe(false);
    expect(canActOnUser('member', 'member')).toBe(false);
    expect(canActOnUser('member', 'admin')).toBe(false);
  });
});

// Share the matrix expectations with the runtime so a change to the expected
// set below fails loudly instead of silently altering behavior.
const _perm = (id: string): Permission => id as Permission;
const ADMIN_EXPECTED: Permission[] = [
  _perm(PERMISSION.FORUM_POST_DELETE_ANY),
  _perm(PERMISSION.FORUM_TOPIC_PIN),
  _perm(PERMISSION.FORUM_TOPIC_LOCK),
  _perm(PERMISSION.FORUM_TOPIC_MOVE),
  _perm(PERMISSION.FORUM_BOARD_MANAGE),
  _perm(PERMISSION.FORUM_CONTENT_AUDIT),
  _perm(PERMISSION.DOWNLOAD_RESOURCE_CREATE),
  _perm(PERMISSION.DOWNLOAD_RESOURCE_DELETE_ANY),
  _perm(PERMISSION.DOWNLOAD_CATEGORY_MANAGE),
  _perm(PERMISSION.USER_WARN),
  _perm(PERMISSION.USER_MUTE),
  _perm(PERMISSION.USER_BAN),
  _perm(PERMISSION.REPORT_HANDLE),
  _perm(PERMISSION.INVITE_CREATE),
  _perm(PERMISSION.ADMIN_DASHBOARD_ACCESS),
  _perm(PERMISSION.SYSTEM_AUDITLOG_VIEW),
  _perm(PERMISSION.SITE_CONFIG_EDIT),
];