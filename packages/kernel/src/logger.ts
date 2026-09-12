import { getEnv, type LogLevel } from './config/env';

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Keys whose values are replaced before anything is written.
 *
 * Logging is the most common way secrets escape a self-hosted app, so redaction
 * happens structurally (by key name, at any depth) rather than by convention.
 */
const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'newpassword',
  'currentpassword',
  'token',
  'tokenhash',
  'accesstoken',
  'refreshtoken',
  'secret',
  'sessionsecret',
  'clientsecret',
  'authorization',
  'cookie',
  'setcookie',
  'apikey',
  'smtppassword',
  'smtp_password',
]);

const REDACTED = '[redacted]';
const MAX_DEPTH = 6;

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = REDACTED_KEYS.has(key.toLowerCase().replace(/[_-]/g, ''))
      ? REDACTED
      : redactValue(nested, depth + 1);
  }
  return output;
}

export type LogFields = Record<string, unknown>;

export interface Logger {
  trace(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  fatal(message: string, fields?: LogFields): void;
  /** Returns a logger that adds `fields` to every entry. */
  child(fields: LogFields): Logger;
}

function resolveLevel(): LogLevel {
  try {
    const env = getEnv();
    return env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug');
  } catch {
    // An invalid environment must not make logging throw — that would hide the
    // real error the operator needs to see.
    return 'info';
  }
}

function emit(level: LogLevel, base: LogFields, message: string, fields?: LogFields): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[resolveLevel()]) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(redactValue({ ...base, ...fields }, 0) as LogFields),
  };

  const line = `${JSON.stringify(entry)}\n`;
  if (LEVEL_ORDER[level] >= LEVEL_ORDER.error) {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

function createLogger(base: LogFields = {}): Logger {
  return {
    trace: (message, fields) => emit('trace', base, message, fields),
    debug: (message, fields) => emit('debug', base, message, fields),
    info: (message, fields) => emit('info', base, message, fields),
    warn: (message, fields) => emit('warn', base, message, fields),
    error: (message, fields) => emit('error', base, message, fields),
    fatal: (message, fields) => emit('fatal', base, message, fields),
    child: (fields) => createLogger({ ...base, ...fields }),
  };
}

/**
 * Minimal structured logger: one JSON object per line on stdout/stderr.
 *
 * A dedicated logging library was deliberately not used here — the transports
 * those libraries rely on (worker threads writing to arbitrary paths, stream
 * shims) are the part that most often breaks when bundled into a server runtime,
 * and this deployment target only needs JSON lines that `docker logs` can read.
 */
export const logger: Logger = createLogger();

/** Test helper: capture emitted lines instead of writing them to the console. */
export function formatLogEntry(level: LogLevel, message: string, fields?: LogFields): string {
  return JSON.stringify({ level, msg: message, ...(redactValue(fields ?? {}, 0) as LogFields) });
}
