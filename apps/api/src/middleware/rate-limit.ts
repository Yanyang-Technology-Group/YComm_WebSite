import { createMiddleware } from 'hono/factory';
import { createRateLimiter, errors } from '@ycomm/kernel';
import { RATE_LIMITS, type RateLimitName } from '@ycomm/config';
import type { AppVariables } from '../context';
import { clientIp } from './session';

/**
 * One limiter for the whole process — single-instance deployment, so a RAM
 * counter is correct. Rules come from `config/policy.ts` (operator-tunable).
 */
const rateLimiter = createRateLimiter(RATE_LIMITS);

function apply(rule: RateLimitName, dimension: 'ip' | 'user', key: string) {
  const decision = rateLimiter.check(rule, dimension, key);
  if (!decision.allowed) {
    throw errors.rateLimited({ rule, retryAfterSeconds: decision.retryAfterSeconds });
  }
}

/**
 * Sliding-window rate limiting by IP (unauthenticated endpoints: login,
 * register, password reset, verification resend).
 */
export const rateLimitByIp =
  (rule: RateLimitName) =>
  createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    apply(rule, 'ip', clientIp(c));
    await next();
  });

/**
 * Sliding-window rate limiting by the authenticated user, falling back to IP
 * for guests (authenticated endpoints: posting, downloads, …).
 */
export const rateLimitByUser =
  (rule: RateLimitName) =>
  createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
    const auth = c.get('auth');
    const key = auth?.userId ?? clientIp(c);
    const dimension = auth ? 'user' : 'ip';
    apply(rule, dimension, key);
    await next();
  });

/**
 * Give back one unit of an IP-scoped budget — for requests that were already
 * counted by `rateLimitByIp` but turned out to be probes (see
 * `verifyCaptchaOrRefund`). No-op if the rule has no `ip` dimension.
 */
export function refundRateLimitByIp(rule: RateLimitName, key: string): void {
  rateLimiter.refund(rule, 'ip', key);
}