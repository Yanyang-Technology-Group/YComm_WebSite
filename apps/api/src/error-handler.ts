import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { logger, newToken, toAppError } from '@ycomm/kernel';

/**
 * The single, mandatory error boundary of the HTTP layer.
 *
 * Every route wraps its work in try/catch (or lets Hono's `onError` collect the
 * throw) so that, by construction, there is exactly one place where an error
 * becomes an HTTP response. Policy denials carry structured `meta`; internal
 * failures expose a trace id and nothing else.
 */
export async function errorHandler(error: unknown, c: Context): Promise<Response> {
  const appError = toAppError(error);

  if (!appError.isClientError) {
    const traceId = newToken(8);
    logger.error(`unhandled error`, {
      traceId,
      code: appError.code,
      message: appError.message,
      cause: appError.cause instanceof Error ? appError.cause.message : undefined,
    });
    return c.json(
      {
        ok: false,
        error: { code: 'INTERNAL', message: 'Internal server error', traceId },
      },
      500,
    );
  }

  return c.json({ ok: false, error: appError.toJSON() }, appError.httpStatus as ContentfulStatusCode);
}

export function notFoundHandler(c: Context): Response {
  return c.json(
    {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Route not found', messageKey: 'NOT_FOUND', meta: {} },
    },
    404,
  );
}