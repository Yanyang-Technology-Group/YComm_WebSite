import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOARD_POLICY,
  describeAccessPolicy,
  isRestrictedPolicy,
  parseAccessPolicy,
  safeParseAccessPolicy,
} from './access-policy';

describe('parseAccessPolicy', () => {
  it('defaults a missing policy to login-only, level 0, no invite', () => {
    const policy = parseAccessPolicy({});
    expect(policy).toEqual({ visibility: 'login', minLevel: 0, requireInvite: false });
    expect(DEFAULT_BOARD_POLICY).toEqual(policy);
  });

  it('accepts a full policy', () => {
    const policy = parseAccessPolicy({
      visibility: 'invite',
      minLevel: 2,
      requireInvite: true,
    });
    expect(policy).toEqual({ visibility: 'invite', minLevel: 2, requireInvite: true });
  });

  it('rejects an unknown visibility and a negative level', () => {
    expect(() => parseAccessPolicy({ visibility: 'everyone' })).toThrow();
    expect(() => parseAccessPolicy({ minLevel: -1 })).toThrow();
  });

  it('strips unknown keys instead of failing on legacy rows', () => {
    const policy = parseAccessPolicy({ visibility: 'public', legacyFlag: true });
    expect('legacyFlag' in policy).toBe(false);
  });
});

describe('safeParseAccessPolicy', () => {
  it('falls back to the default policy instead of throwing', () => {
    expect(safeParseAccessPolicy({ visibility: 'nonsense' })).toEqual(DEFAULT_BOARD_POLICY);
    expect(safeParseAccessPolicy(undefined)).toEqual(DEFAULT_BOARD_POLICY);
  });
});

describe('describeAccessPolicy', () => {
  it('renders a human-readable summary for the UI', () => {
    expect(describeAccessPolicy({ visibility: 'login', minLevel: 0, requireInvite: false })).toBe(
      '需登录',
    );
    expect(describeAccessPolicy({ visibility: 'public', minLevel: 0, requireInvite: false })).toBe(
      '所有人可读',
    );
    expect(
      describeAccessPolicy({ visibility: 'login', minLevel: 2, requireInvite: true }),
    ).toBe('需登录 · 等级 ≥ Lv2 · 需邀请码解锁');
  });
});

describe('isRestrictedPolicy', () => {
  it('detects any gate beyond public reading', () => {
    expect(isRestrictedPolicy({ visibility: 'public', minLevel: 0, requireInvite: false })).toBe(
      false,
    );
    expect(isRestrictedPolicy({ visibility: 'login', minLevel: 0, requireInvite: false })).toBe(
      true,
    );
    expect(isRestrictedPolicy({ visibility: 'public', minLevel: 1, requireInvite: false })).toBe(
      true,
    );
  });
});