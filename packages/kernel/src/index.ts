/**
 * `@ycomm/kernel` — infrastructure shared by every layer.
 *
 * Nothing in here may depend on the database, the HTTP framework, or the UI, so
 * that each of those can be replaced (or extracted into its own process) without
 * touching the others.
 */
export {
  DATABASE_DRIVERS,
  EnvValidationError,
  LOG_LEVELS,
  NODE_ENVS,
  captchaConfig,
  enabledOAuthProviders,
  envSchema,
  getEnv,
  hasSmtp,
  isProduction,
  loadEnv,
  resetEnvCache,
  siteUrl,
  type CaptchaConfig,
  type DatabaseDriver,
  type Env,
  type EnvSource,
  type LogLevel,
  type NodeEnv,
} from './config/env';

export {
  AppError,
  ErrorCodes,
  errors,
  isAppError,
  toAppError,
  type AppErrorOptions,
  type ErrorCode,
} from './errors';

export { formatLogEntry, logger, type LogFields, type Logger } from './logger';

export { hashToken, newId, newToken, safeEqual } from './id';

export {
  createRateLimiter,
  InMemoryRateLimiter,
  type RateLimitDecision,
  type RateLimitRule,
} from './rate-limit';
