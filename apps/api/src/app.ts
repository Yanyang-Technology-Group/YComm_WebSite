import { Hono, type Context } from 'hono';
import { getDb } from '@ycomm/db';
import { logger } from '@ycomm/kernel';
import { startJobWorker } from '@ycomm/jobs';
import { registerMailJobHandler } from '@ycomm/notify';
import { registerForumDeciders } from '@ycomm/forum';
import { registerDownloadDeciders } from '@ycomm/downloads';
import { errorHandler, notFoundHandler } from './error-handler';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { forumRoutes } from './routes/forum';
import { downloadsRoutes } from './routes/downloads';
import { adminRoutes } from './routes/admin';

/** Small request logger — one JSON line per request, status and duration. */
function requestLogger() {
  return async (c: Context, next: () => Promise<void>) => {
    const startedAt = Date.now();
    await next();
    logger.info('request', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - startedAt,
    });
  };
}

let booted = false;

/**
 * One-time boot: register job handlers and deciders, start the in-process
 * queue worker. Idempotent because Next.js dev re-imports modules on hot load.
 */
function boot(): void {
  if (booted) return;
  booted = true;

  registerMailJobHandler();
  registerForumDeciders();
  registerDownloadDeciders();

  void getDb()
    .then((handle) => {
      startJobWorker({ db: handle.db, logger });
    })
    .catch((error) => {
      logger.error('job worker failed to start', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

/**
 * The API application. Everything is prefixed with `/api` inside this app so the
 * same routes work whether Hono runs standalone (future extraction) or mounted
 * under Next's `/api/[[...route]]` catch-all.
 */
export function createApp(): Hono {
  boot();

  const app = new Hono();
  app.use('*', requestLogger());
  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  app.route('/api', healthRoutes());
  app.route('/api/auth', authRoutes());
  app.route('/api/forum', forumRoutes());
  app.route('/api/downloads', downloadsRoutes());
  app.route('/api/admin', adminRoutes());

  return app;
}