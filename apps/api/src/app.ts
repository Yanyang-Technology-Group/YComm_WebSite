import { Hono, type Context } from 'hono';
import { getDb, type Db } from '@ycomm/db';
import { logger, type Logger } from '@ycomm/kernel';
import { startJobWorker } from '@ycomm/jobs';
import { sweepUnverifiedAccounts } from '@ycomm/identity';
import { registerMailJobHandler } from '@ycomm/notify';
import { registerForumDeciders } from '@ycomm/forum';
import { registerDownloadDeciders } from '@ycomm/downloads';
import { errorHandler, notFoundHandler } from './error-handler';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { forumRoutes } from './routes/forum';
import { downloadsRoutes } from './routes/downloads';
import { adminRoutes } from './routes/admin';
import { uploadRoutes } from './routes/uploads';
import { usersRoutes } from './routes/users';
import { notificationsRoutes } from './routes/notifications';

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

/**
 * JSON 响应补上 `charset=utf-8`。
 *
 * `c.json()` 只发 `application/json`，而 Windows PowerShell 5.1 这类客户端在没有
 * charset 时按 ISO-8859-1 解码响应体 —— 中文会变成乱码（例如
 * 「社区客户端APP」→「ç¤¾åºå®¢æ·ç«¯APP」），导致任何按标题/昵称比对的脚本认不出
 * 已有数据。JSON 本身就是 UTF-8，声明出来是正确且必要的。
 */
function jsonCharset() {
  return async (c: Context, next: () => Promise<void>) => {
    await next();
    const contentType = c.res.headers.get('content-type');
    if (contentType && contentType.startsWith('application/json') && !/charset=/i.test(contentType)) {
      c.res.headers.set('content-type', `${contentType}; charset=utf-8`);
    }
  };
}

let booted = false;

/** 未验证邮箱账号的巡检间隔：每半小时看一次，是否真的发信由「距上一封 ≥6 小时」决定。 */
const UNVERIFIED_SWEEP_INTERVAL_MS = 30 * 60 * 1000;
/** 启动后第一次巡检的延迟：让迁移/启动先跑完。 */
const UNVERIFIED_SWEEP_FIRST_DELAY_MS = 15_000;

/**
 * 未验证邮箱账号的定期清理：每 6 小时提醒一次，注册满 3 天仍未验证就自动注销。
 *
 * 和作业队列一样是进程内的定时器：容器里只有一个应用进程，一个 interval 就是全部调度。
 */
function startUnverifiedAccountSweep(options: { db: Db; logger: Logger }): () => void {
  const run = () => {
    void sweepUnverifiedAccounts(options.db)
      .then((result) => {
        if (result.reminded > 0 || result.purged > 0) {
          options.logger.info('unverified account sweep', { ...result });
        }
      })
      .catch((error) => {
        options.logger.error('unverified account sweep failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  };

  const first = setTimeout(run, UNVERIFIED_SWEEP_FIRST_DELAY_MS);
  first.unref?.();
  const timer = setInterval(run, UNVERIFIED_SWEEP_INTERVAL_MS);
  // Do not keep the process alive just for the sweep.
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

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
      startUnverifiedAccountSweep({ db: handle.db, logger });
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
  // 必须放在路由之前：包住所有响应，统一给 JSON 补 charset=utf-8
  app.use('*', jsonCharset());
  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  app.route('/api', healthRoutes());
  app.route('/api/auth', authRoutes());
  app.route('/api/forum', forumRoutes());
  app.route('/api/downloads', downloadsRoutes());
  app.route('/api/admin', adminRoutes());
  app.route('/api/uploads', uploadRoutes());
  app.route('/api/users', usersRoutes());
  app.route('/api/notifications', notificationsRoutes());

  return app;
}