/**
 * Machine-readable error codes shared by the API layer and the UI.
 *
 * The API responds with `{ ok: false, error: { code, messageKey, meta, message? } }`；
 * `message` 只在 `expose: true`（面向用户的文案，中文）时才带给客户端。UI 先按
 * `code` 出固定中文，没有对应条目时直接用服务端的 `message` —— 这样
 * 「用户名已被使用」这类具体原因不会退化成「操作冲突」。
 */
export const ErrorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',

  // account state gate (step 1 of the access decision chain)
  ACCOUNT_UNVERIFIED: 'ACCOUNT_UNVERIFIED',
  ACCOUNT_MUTED: 'ACCOUNT_MUTED',
  ACCOUNT_BANNED: 'ACCOUNT_BANNED',

  // bootstrap & registration gates
  NOT_INITIALIZED: 'NOT_INITIALIZED',
  REGISTRATION_CLOSED: 'REGISTRATION_CLOSED',

  // resource policy gate (step 2)
  ACCESS_LOGIN_REQUIRED: 'ACCESS_LOGIN_REQUIRED',
  ACCESS_LEVEL_TOO_LOW: 'ACCESS_LEVEL_TOO_LOW',
  ACCESS_INVITE_REQUIRED: 'ACCESS_INVITE_REQUIRED',

  // resource lifecycle
  RESOURCE_NOT_PUBLISHED: 'RESOURCE_NOT_PUBLISHED',
  RESOURCE_LINK_UNAVAILABLE: 'RESOURCE_LINK_UNAVAILABLE',

  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface AppErrorOptions {
  code: ErrorCode | string;
  /** HTTP status the API layer should respond with. Defaults to 500. */
  httpStatus?: number;
  /** i18n key resolved by the UI. Defaults to the code itself. */
  messageKey?: string;
  /** Developer-facing message. Never sent to clients unless `expose` is true. */
  message?: string;
  /**
   * Structured details handed to the client as-is — this is how a policy denial
   * explains itself, e.g. `{ requiredLevel: 2 }` or `{ requireInvite: true }`.
   */
  meta?: Record<string, unknown>;
  /** Set true only when `message` is safe to display to end users. */
  expose?: boolean;
  cause?: unknown;
}

/**
 * The single error type used across every layer.
 *
 * Anything that is not an `AppError` reaching the API boundary is treated as an
 * internal failure: logged with a trace id, reported to the client as a bare 500.
 */
export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly messageKey: string;
  readonly meta: Record<string, unknown>;
  readonly expose: boolean;
  override readonly cause: unknown;

  constructor(options: AppErrorOptions) {
    super(options.message ?? options.code);
    this.name = 'AppError';
    this.code = options.code;
    this.httpStatus = options.httpStatus ?? 500;
    this.messageKey = options.messageKey ?? options.code;
    this.meta = options.meta ?? {};
    this.expose = options.expose ?? false;
    this.cause = options.cause;
  }

  /** True for 4xx — these are expected outcomes, not incidents, and are not alerted on. */
  get isClientError(): boolean {
    return this.httpStatus >= 400 && this.httpStatus < 500;
  }

  /**
   * Wire format.
   *
   * `message` is attached only for errors explicitly marked `expose: true`, i.e.
   * messages written to be shown to end users. Developer-facing messages and
   * internal failures never leave the server.
   */
  toJSON(): {
    code: string;
    messageKey: string;
    meta: Record<string, unknown>;
    message?: string;
  } {
    return {
      code: this.code,
      messageKey: this.messageKey,
      meta: this.meta,
      ...(this.expose ? { message: this.message } : {}),
    };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Normalize anything thrown into an `AppError` without leaking internals. */
export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;

  // Zod-style validation errors carry an `issues` array; keep the paths, drop the values.
  if (typeof value === 'object' && value !== null && 'issues' in value) {
    const issues = (value as { issues?: readonly { path?: readonly PropertyKey[]; message?: string }[] })
      .issues;
    if (Array.isArray(issues)) {
      return new AppError({
        code: ErrorCodes.VALIDATION_FAILED,
        httpStatus: 400,
        message: '输入内容有误',
        meta: {
          issues: issues.map((issue) => ({
            path: (issue.path ?? []).map(String).join('.'),
            message: issue.message ?? 'invalid',
          })),
        },
      });
    }
  }

  return new AppError({
    code: ErrorCodes.INTERNAL,
    message: value instanceof Error ? value.message : String(value),
    cause: value,
  });
}

/**
 * Error factories for the common cases. Callers add `meta` where the client needs
 * to explain the outcome (especially policy denials).
 */
export const errors = {
  validation: (meta?: Record<string, unknown>) =>
    new AppError({
      code: ErrorCodes.VALIDATION_FAILED,
      httpStatus: 400,
      message: 'Request validation failed',
      expose: true,
      ...(meta ? { meta } : {}),
    }),

  unauthenticated: (message = '请先登录') =>
    new AppError({
      code: ErrorCodes.UNAUTHENTICATED,
      httpStatus: 401,
      message,
      expose: true,
    }),

  forbidden: (message = '没有权限', meta?: Record<string, unknown>) =>
    new AppError({
      code: ErrorCodes.FORBIDDEN,
      httpStatus: 403,
      message,
      expose: true,
      ...(meta ? { meta } : {}),
    }),

  notFound: (message = '内容不存在') =>
    new AppError({ code: ErrorCodes.NOT_FOUND, httpStatus: 404, message, expose: true }),

  conflict: (message = '该内容已存在', meta?: Record<string, unknown>) =>
    new AppError({
      code: ErrorCodes.CONFLICT,
      httpStatus: 409,
      message,
      expose: true,
      ...(meta ? { meta } : {}),
    }),

  rateLimited: (meta?: Record<string, unknown>) =>
    new AppError({
      code: ErrorCodes.RATE_LIMITED,
      httpStatus: 429,
      message: '请求过于频繁，请稍后再试',
      expose: true,
      ...(meta ? { meta } : {}),
    }),

  // ---- access decision chain ------------------------------------------

  loginRequired: () =>
    new AppError({
      code: ErrorCodes.ACCESS_LOGIN_REQUIRED,
      httpStatus: 401,
      message: '请先登录',
      expose: true,
    }),

  /** `meta.requiredLevel` lets the UI say "需要 Lv2" instead of a bare 403. */
  levelTooLow: (requiredLevel: number, currentLevel: number) =>
    new AppError({
      code: ErrorCodes.ACCESS_LEVEL_TOO_LOW,
      httpStatus: 403,
      message: `需要等级 Lv${requiredLevel} 或更高`,
      expose: true,
      meta: { requiredLevel, currentLevel },
    }),

  /** `meta.requireInvite` lets the UI offer the "redeem invite code" flow. */
  inviteRequired: () =>
    new AppError({
      code: ErrorCodes.ACCESS_INVITE_REQUIRED,
      httpStatus: 403,
      message: '这个内容需要注册码才能访问',
      expose: true,
      meta: { requireInvite: true },
    }),

  accountUnverified: () =>
    new AppError({
      code: ErrorCodes.ACCOUNT_UNVERIFIED,
      httpStatus: 403,
      message: '请先验证邮箱',
      expose: true,
    }),

  accountMuted: (until: Date | null) =>
    new AppError({
      code: ErrorCodes.ACCOUNT_MUTED,
      httpStatus: 403,
      message: '账号处于禁言状态',
      expose: true,
      meta: { until: until ? until.toISOString() : null },
    }),

  accountBanned: (reason: string | null) =>
    new AppError({
      code: ErrorCodes.ACCOUNT_BANNED,
      httpStatus: 403,
      message: '账号已被封禁',
      expose: true,
      meta: { reason },
    }),

  /** The site has no owner yet — run the owner bootstrap CLI first. */
  siteNotInitialized: () =>
    new AppError({
      code: ErrorCodes.NOT_INITIALIZED,
      httpStatus: 409,
      message: '站点尚未初始化，请先创建站长账号',
      expose: true,
    }),

  registrationClosed: () =>
    new AppError({
      code: ErrorCodes.REGISTRATION_CLOSED,
      httpStatus: 403,
      message: '注册暂未开放',
      expose: true,
    }),

  internal: (cause?: unknown, message = 'Internal server error') =>
    new AppError({ code: ErrorCodes.INTERNAL, message, cause }),
} as const;
