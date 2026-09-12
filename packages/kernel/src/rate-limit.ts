/**
 * In-memory sliding-window rate limiter.
 *
 * Single-instance deployments only — this deployment is explicitly a modular
 * monolith with one process, so RAM-backed counters are correct and keep Redis
 * out of the picture. Per-day quotas that must survive restarts (download
 * limits) are counted in the database instead (`download_logs`), never here.
 *
 * Each (rule × dimension × key) has its own window, and every dimension must
 * pass, so one abusive IP cannot exhaust a signed-in user's budget and vice
 * versa.
 *
 * Rules are injected (e.g. from `config/policy.ts`) so kernel stays the bottom
 * layer and never depends on configuration upward.
 */

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
  /** Every listed dimension gets its own budget; all of them must pass. */
  dimensions: readonly ('ip' | 'user')[];
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the window opens again; present when denied. */
  retryAfterSeconds?: number;
}

interface Bucket {
  /** Timestamps (ms) of hits inside the current window. */
  hits: number[];
  windowSeconds: number;
  limit: number;
}

function nowMs(): number {
  return Date.now();
}

export class InMemoryRateLimiter<TRules extends Record<string, RateLimitRule>> {
  constructor(private readonly rules: TRules) {}

  private readonly buckets = new Map<string, Bucket>();

  private pruneExpired(): void {
    // Lazy sweep: once the table grows past a sanity bound, drop expired
    // buckets in one pass. Bounded memory, amortised O(n).
    if (this.buckets.size < 10_000) return;
    const cutoff = nowMs();
    for (const [key, bucket] of this.buckets) {
      if (bucket.hits.every((hit) => cutoff - hit > bucket.windowSeconds * 1000)) {
        this.buckets.delete(key);
      }
    }
  }

  /**
   * Record one hit and decide whether it is allowed.
   * @param bucketKey stable identity, e.g. `login:ip:203.0.113.7`.
   */
  check(
    ruleName: keyof TRules & string,
    dimension: 'ip' | 'user',
    key: string,
  ): RateLimitDecision {
    const rule = this.rules[ruleName];
    if (!rule) {
      // Unknown rule name is a programming error — fail loud, never silently allow.
      throw new Error(`Unknown rate limit rule: ${String(ruleName)}`);
    }
    if (!rule.dimensions.includes(dimension)) {
      // The rule does not constrain this dimension — pass it through.
      return { allowed: true };
    }

    this.pruneExpired();
    const bucketKey = `${String(ruleName)}:${dimension}:${key}`;
    const now = nowMs();
    const windowMs = rule.windowSeconds * 1000;

    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      bucket = { hits: [], windowSeconds: rule.windowSeconds, limit: rule.limit };
      this.buckets.set(bucketKey, bucket);
    }

    // Drop hits outside the current window.
    bucket.hits = bucket.hits.filter((hit) => now - hit < windowMs);

    if (bucket.hits.length >= rule.limit) {
      const oldestAllowed = bucket.hits[0];
      const retryAfterSeconds =
        oldestAllowed === undefined
          ? rule.windowSeconds
          : Math.max(1, Math.ceil((oldestAllowed + windowMs - now) / 1000));
      return { allowed: false, retryAfterSeconds };
    }

    bucket.hits.push(now);
    return { allowed: true };
  }

  /** Test helper: reset all state. */
  reset(): void {
    this.buckets.clear();
  }
}

/** Convenience factory: `createRateLimiter(RATE_LIMITS)` wires config in at runtime. */
export function createRateLimiter<TRules extends Record<string, RateLimitRule>>(
  rules: TRules,
): InMemoryRateLimiter<TRules> {
  return new InMemoryRateLimiter(rules);
}