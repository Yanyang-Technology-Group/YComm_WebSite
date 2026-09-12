import { describe, expect, it } from 'vitest';
import { createRateLimiter, InMemoryRateLimiter } from './rate-limit';
import type { RateLimitRule } from './rate-limit';

const RULES = {
  register: { limit: 5, windowSeconds: 3600, dimensions: ['ip'] as const },
  login: { limit: 10, windowSeconds: 300, dimensions: ['ip'] as const },
  postCreate: { limit: 30, windowSeconds: 3600, dimensions: ['ip', 'user'] as const },
} satisfies Record<string, RateLimitRule>;

describe('InMemoryRateLimiter', () => {
  it('allows requests under the limit and denies at the limit', () => {
    const limiter = createRateLimiter(RULES);
    for (let index = 0; index < 5; index++) {
      expect(limiter.check('register', 'ip', '203.0.113.1').allowed).toBe(true);
    }
    const denied = limiter.check('register', 'ip', '203.0.113.1');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('windows are per key, not global', () => {
    const limiter = createRateLimiter(RULES);
    for (let index = 0; index < 5; index++) {
      limiter.check('register', 'ip', 'a');
    }
    expect(limiter.check('register', 'ip', 'b').allowed).toBe(true);
  });

  it('respects per-dimension budgets independently', () => {
    const limiter = createRateLimiter(RULES);
    for (let index = 0; index < 30; index++) {
      limiter.check('postCreate', 'ip', 'bad-ip');
    }
    // One user's IP cannot exhaust another dimension's budget.
    expect(limiter.check('postCreate', 'user', 'good-user').allowed).toBe(true);
    // But the same-dimension budget is exhausted.
    expect(limiter.check('postCreate', 'ip', 'bad-ip').allowed).toBe(false);
  });

  it('rejects dimensions a rule does not constrain (pass-through)', () => {
    const limiter = createRateLimiter(RULES);
    // login rule is ip-only; a per-user call is always allowed by this rule
    expect(limiter.check('login', 'user', 'user-1').allowed).toBe(true);
  });

  it('recovers after reset', () => {
    const limiter = createRateLimiter(RULES);
    for (let index = 0; index < 5; index++) {
      limiter.check('register', 'ip', 'x');
    }
    expect(limiter.check('register', 'ip', 'x').allowed).toBe(false);
    limiter.reset();
    expect(limiter.check('register', 'ip', 'x').allowed).toBe(true);
  });

  it('is generic over the injected rules', () => {
    const custom = new InMemoryRateLimiter({ custom: { limit: 1, windowSeconds: 60, dimensions: ['ip'] } });
    expect(custom.check('custom', 'ip', 'k').allowed).toBe(true);
    expect(custom.check('custom', 'ip', 'k').allowed).toBe(false);
  });
});