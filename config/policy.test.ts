import { describe, expect, it } from 'vitest';
import { computeLevel, LEVELS, MAX_LEVEL, REGISTRATION } from './policy';

describe('computeLevel', () => {
  it('everyone starts at level 0', () => {
    expect(computeLevel({ postCount: 0, likeReceivedCount: 0, accountAgeDays: 0 })).toBe(0);
    expect(computeLevel({ postCount: 4, likeReceivedCount: 0, accountAgeDays: 2 })).toBe(0);
  });

  it('requires all thresholds simultaneously', () => {
    // 5 posts but no likes and too young
    expect(computeLevel({ postCount: 5, likeReceivedCount: 0, accountAgeDays: 3 })).toBe(0);
    // Likes alone don't count: 50 likes but only 1 post
    expect(computeLevel({ postCount: 1, likeReceivedCount: 50, accountAgeDays: 3 })).toBe(0);
    // All three met
    expect(computeLevel({ postCount: 5, likeReceivedCount: 1, accountAgeDays: 3 })).toBe(1);
  });

  it('climbs to the highest met level, not the first', () => {
    expect(
      computeLevel({ postCount: 300, likeReceivedCount: 200, accountAgeDays: 180 }),
    ).toBe(MAX_LEVEL);
  });

  it('level definitions are ordered and continuous', () => {
    for (let index = 1; index < LEVELS.length; index++) {
      const previous = LEVELS[index - 1];
      const current = LEVELS[index];
      if (!previous || !current) continue;
      expect(current.level).toBe(previous.level + 1);
    }
  });
});

describe('registration rules', () => {
  it('validates usernames against the shared pattern', () => {
    expect(REGISTRATION.usernamePattern.test('alice')).toBe(true);
    expect(REGISTRATION.usernamePattern.test('a_b-9')).toBe(true);
    expect(REGISTRATION.usernamePattern.test('ab')).toBe(false); // too short
    expect(REGISTRATION.usernamePattern.test('a'.repeat(21))).toBe(false); // too long
    expect(REGISTRATION.usernamePattern.test('中文名')).toBe(false);
  });

  it('reserves impersonation targets and is case-insensitive at lookup time', () => {
    const lower = REGISTRATION.reservedUsernames.map((name) => name.toLowerCase());
    expect(lower).toContain('admin');
    expect(lower).toContain('root');
    expect(lower).toContain('owner');
  });
});