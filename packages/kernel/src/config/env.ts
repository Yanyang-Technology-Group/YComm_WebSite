import { z } from 'zod';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export const DATABASE_DRIVERS = ['pglite', 'postgres'] as const;
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

export type NodeEnv = (typeof NODE_ENVS)[number];
export type DatabaseDriver = (typeof DATABASE_DRIVERS)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Booleans from env are read as an explicit allow-list. `z.coerce.boolean()` is
 * deliberately avoided because it treats the string "false" as `true`.
 */
const booleanFromEnv = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((raw) => {
      if (raw === undefined || raw.trim() === '') return defaultValue;
      return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
    });

const integerFromEnv = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw.trim() === '') return defaultValue;
      const parsed = Number.parseInt(raw.trim(), 10);
      if (!Number.isInteger(parsed)) {
        ctx.addIssue({ code: 'custom', message: `expected an integer, received "${raw}"` });
        return z.NEVER;
      }
      return parsed;
    });

const optionalText = z
  .string()
  .transform((raw) => raw.trim())
  .refine((raw) => raw.length > 0, { message: 'must not be empty when present' })
  .optional();

export const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default('development'),
    PORT: integerFromEnv(3000),
    LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
    /** Public origin of the site, used for links in emails and OAuth redirects. */
    SITE_URL: optionalText,
    /** Branding overrides — operators of a self-hosted instance never edit code. */
    SITE_NAME: optionalText,
    SITE_TAGLINE: optionalText,
    SITE_DESCRIPTION: optionalText,
    SITE_ICP: optionalText,
    /** Shown in the footer next to the version. Required by AGPL for network users. */
    SITE_SOURCE_URL: optionalText,

    // ---- database -------------------------------------------------------
    DATABASE_DRIVER: z.enum(DATABASE_DRIVERS).default('pglite'),
    /** Required when DATABASE_DRIVER=postgres. */
    DATABASE_URL: optionalText,
    /** PGlite (embedded Postgres) data directory used by local dev and tests. */
    PGLITE_DATA_DIR: z.string().default('./.data/pglite'),

    // ---- sessions -------------------------------------------------------
    /** Required in production. Used to sign session identifiers. */
    SESSION_SECRET: optionalText,
    SESSION_COOKIE_NAME: z.string().default('__Host-ycomm_session'),
    SESSION_TTL_DAYS: integerFromEnv(30),

    // ---- uploads --------------------------------------------------------
    UPLOAD_DIR: z.string().default('./uploads'),
    /** Keep below the Cloudflare tunnel request-body limit (100MB on free plans). */
    MAX_UPLOAD_BYTES: integerFromEnv(50 * 1024 * 1024),

    // ---- outbound mail (optional; falls back to console logging in dev) --
    SMTP_HOST: optionalText,
    SMTP_PORT: integerFromEnv(587),
    SMTP_USER: optionalText,
    SMTP_PASSWORD: optionalText,
    SMTP_SECURE: booleanFromEnv(false),
    MAIL_FROM: optionalText,
    /** Resend HTTP API key (https://resend.com). Takes priority over SMTP when set. */
    RESEND_API_KEY: optionalText,

    // ---- OAuth providers (optional adapters, hidden when unconfigured) ---
    OAUTH_GITHUB_CLIENT_ID: optionalText,
    OAUTH_GITHUB_CLIENT_SECRET: optionalText,
    OAUTH_GOOGLE_CLIENT_ID: optionalText,
    OAUTH_GOOGLE_CLIENT_SECRET: optionalText,

    // ---- 注册人机验证（Cap.js PoW + 自托管 cap-worker，可选） -----------
    CAPTCHA_ENDPOINT: optionalText,
    CAPTCHA_SITE_KEY: optionalText,
    CAPTCHA_SCRIPT: optionalText,

    /** Trust `CF-Connecting-IP` / `X-Forwarded-For` when behind a reverse proxy. */
    TRUST_PROXY_HEADERS: booleanFromEnv(true),
  })
  .superRefine((value, ctx) => {
    if (value.DATABASE_DRIVER === 'postgres' && !value.DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'is required when DATABASE_DRIVER=postgres',
      });
    }
    if (value.NODE_ENV === 'production' && !value.SESSION_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'is required in production',
      });
    }
    if (value.SESSION_SECRET !== undefined && value.SESSION_SECRET.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'must be at least 32 characters long',
      });
    }

    // SMTP is all-or-nothing: a half-configured mailer silently swallows mail.
    const smtpConfigured = [value.SMTP_HOST, value.SMTP_USER].filter(Boolean).length;
    if (smtpConfigured === 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST and SMTP_USER must be configured together',
      });
    }
    const mailProviderConfigured =
      value.SMTP_HOST !== undefined || value.RESEND_API_KEY !== undefined;
    if (mailProviderConfigured && value.MAIL_FROM === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_FROM'],
        message: 'is required when SMTP_HOST or RESEND_API_KEY is configured',
      });
    }

    // OAuth providers need both halves of the credential pair.
    for (const provider of ['GITHUB', 'GOOGLE'] as const) {
      const id = value[`OAUTH_${provider}_CLIENT_ID`];
      const secret = value[`OAUTH_${provider}_CLIENT_SECRET`];
      if ((id === undefined) !== (secret === undefined)) {
        ctx.addIssue({
          code: 'custom',
          path: [`OAUTH_${provider}_CLIENT_ID`],
          message: `CLIENT_ID and CLIENT_SECRET must both be set or both be empty`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export type EnvSource = Record<string, string | undefined>;

export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      [
        'Invalid environment configuration:',
        ...issues.map((issue) => `  - ${issue}`),
        '',
        'See .env.example for the full list of supported variables.',
      ].join('\n'),
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/** Parse and validate an environment source. Throws {@link EnvValidationError}. */
export function loadEnv(source: EnvSource = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new EnvValidationError(issues);
  }
  return result.data;
}

let cachedEnv: Env | undefined;

/**
 * Lazily validated process environment.
 *
 * Validation is deliberately deferred until first use so that importing a module
 * during build (where runtime env vars are absent) does not throw.
 */
export function getEnv(): Env {
  if (cachedEnv === undefined) {
    cachedEnv = loadEnv();
  }
  return cachedEnv;
}

/** Test helper: drop the memoized environment so the next `getEnv()` re-reads it. */
export function resetEnvCache(): void {
  cachedEnv = undefined;
}

export function isProduction(env: Env = getEnv()): boolean {
  return env.NODE_ENV === 'production';
}

/** Effective public origin, falling back to a local address during development. */
export function siteUrl(env: Env = getEnv()): string {
  return env.SITE_URL ?? `http://localhost:${env.PORT}`;
}

/** Which OAuth providers are configured. Unconfigured providers must stay hidden in the UI. */
export function enabledOAuthProviders(env: Env = getEnv()): readonly ('github' | 'google')[] {
  const providers: ('github' | 'google')[] = [];
  if (env.OAUTH_GITHUB_CLIENT_ID !== undefined) providers.push('github');
  if (env.OAUTH_GOOGLE_CLIENT_ID !== undefined) providers.push('google');
  return providers;
}

export interface CaptchaConfig {
  endpoint: string;
  siteKey: string;
  script: string;
}

/** 注册验证码配置；未配置 CAPTCHA_ENDPOINT + CAPTCHA_SITE_KEY 时返回 null（即关闭）。 */
export function captchaConfig(env: Env = getEnv()): CaptchaConfig | null {
  if (!env.CAPTCHA_ENDPOINT || !env.CAPTCHA_SITE_KEY) return null;
  return {
    endpoint: env.CAPTCHA_ENDPOINT.replace(/\/$/, ''),
    siteKey: env.CAPTCHA_SITE_KEY,
    script: env.CAPTCHA_SCRIPT ?? 'https://cdn.jsdelivr.net/npm/@cap.js/captcha@1/dist/captcha.min.js',
  };
}

/** True when a real SMTP transport is configured; otherwise mail is logged instead of sent. */
export function hasSmtp(env: Env = getEnv()): boolean {
  return env.SMTP_HOST !== undefined;
}

/** True when the Resend HTTP transport is configured; it takes priority over SMTP. */
export function hasResend(env: Env = getEnv()): boolean {
  return env.RESEND_API_KEY !== undefined;
}
