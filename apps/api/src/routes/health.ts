import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { getDb } from '@ycomm/db';
import { getSiteBranding } from '@ycomm/config';
import { logger } from '@ycomm/kernel';
import { APP_NAME, APP_VERSION } from '../version';

/**
 * `GET /api/healthz` — readiness probe used by the container healthcheck.
 *
 * Deliberately touches the database so a "healthy" answer means the full
 * request path (load balancer → app → pool → Postgres/PGlite) actually works.
 */
export function healthRoutes(): Hono {
  const router = new Hono();

  router.get('/healthz', async (c) => {
    let dbStatus = 'up';
    let probeError = '';
    try {
      const handle = await getDb();
      await handle.db.execute(sql`select 1`);
    } catch (error) {
      dbStatus = 'down';
      probeError = error instanceof Error ? error.message : String(error);
      logger.error('health check: database probe failed', { error: probeError });
    }

    const healthy = dbStatus === 'up';
    return c.json(
      {
        ok: healthy,
        service: APP_NAME,
        name: getSiteBranding().name,
        version: APP_VERSION,
        db: dbStatus,
        time: new Date().toISOString(),
      },
      healthy ? 200 : 503,
    );
  });

  return router;
}