import { describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from './env';

function source(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'test',
    ...overrides,
  };
}

describe('loadEnv', () => {
  it('applies defaults for an empty test environment', () => {
    const env = loadEnv(source());
    expect(env.NODE_ENV).toBe('test');
    expect(env.DATABASE_DRIVER).toBe('pglite');
    expect(env.PORT).toBe(3000);
    expect(env.SESSION_TTL_DAYS).toBe(30);
    expect(env.MAX_UPLOAD_BYTES).toBe(50 * 1024 * 1024);
    expect(env.TRUST_PROXY_HEADERS).toBe(true);
  });

  it('parses booleans by allow-list, not by truthiness', () => {
    expect(loadEnv(source({ TRUST_PROXY_HEADERS: 'false' })).TRUST_PROXY_HEADERS).toBe(false);
    expect(loadEnv(source({ TRUST_PROXY_HEADERS: '0' })).TRUST_PROXY_HEADERS).toBe(false);
    expect(loadEnv(source({ TRUST_PROXY_HEADERS: 'true' })).TRUST_PROXY_HEADERS).toBe(true);
  });

  it('requires DATABASE_URL for the postgres driver', () => {
    expect(() => loadEnv(source({ DATABASE_DRIVER: 'postgres' }))).toThrowError(/DATABASE_URL/);
    const ok = loadEnv(source({ DATABASE_DRIVER: 'postgres', DATABASE_URL: 'postgres://x' }));
    expect(ok.DATABASE_URL).toBe('postgres://x');
  });

  it('requires SESSION_SECRET in production', () => {
    expect(() => loadEnv(source({ NODE_ENV: 'production' }))).toThrowError(/SESSION_SECRET/);
  });

  it('enforces a minimum SESSION_SECRET length', () => {
    expect(() =>
      loadEnv(source({ NODE_ENV: 'production', SESSION_SECRET: 'too-short' })),
    ).toThrowError(/at least 32/);
    expect(() =>
      loadEnv(source({ NODE_ENV: 'production', SESSION_SECRET: 'a'.repeat(32) })),
    ).not.toThrow();
  });

  it('treats a half-configured SMTP block as an error', () => {
    expect(() => loadEnv(source({ SMTP_HOST: 'smtp.example.com' }))).toThrowError(
      /SMTP_HOST and SMTP_USER/,
    );
  });

  it('requires MAIL_FROM when SMTP is present', () => {
    expect(() =>
      loadEnv(source({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'u' })),
    ).toThrowError(/MAIL_FROM/);
  });

  it('rejects OAuth providers configured with only one credential half', () => {
    expect(() =>
      loadEnv(source({ OAUTH_GITHUB_CLIENT_ID: 'id-only' })),
    ).toThrowError(/CLIENT_ID and CLIENT_SECRET/);
    expect(() =>
      loadEnv(
        source({
          OAUTH_GITHUB_CLIENT_ID: 'id',
          OAUTH_GITHUB_CLIENT_SECRET: 'secret',
        }),
      ),
    ).not.toThrow();
  });

  it('reports every issue at once, in a readable block', () => {
    try {
      loadEnv(source({ NODE_ENV: 'production', DATABASE_DRIVER: 'postgres' }));
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('SESSION_SECRET');
    }
  });
});

describe('resetEnvCache', () => {
  it('drops the memoized environment', () => {
    resetEnvCache();
    const env = loadEnv(source({ PORT: '4000' }));
    expect(env.PORT).toBe(4000);
  });
});