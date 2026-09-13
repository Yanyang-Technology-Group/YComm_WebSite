import { execSync } from 'node:child_process';
import type { NextConfig } from 'next';

/**
 * 版本号：`yyyy.mm.dd.<提交数>`（例如 2026.09.13.7）。
 *
 * 取值顺序：
 *   1. `NEXT_PUBLIC_APP_VERSION` —— Docker/CI 构建时由 release workflow 通过
 *      `--build-arg APP_VERSION=vYYYY.MM.DD.commits` 注入（镜像里没有 .git，
 *      见 .dockerignore，所以只能这样传）；
 *   2. 本地开发/构建 —— 直接数当前仓库的提交数（.git 在本地是存在的）；
 *   3. 都拿不到 —— 退化成只有日期，绝不因此让构建失败。
 */
function resolveAppVersion(): string {
  const injected = process.env.NEXT_PUBLIC_APP_VERSION?.trim();
  if (injected) return injected.replace(/^v/, '');

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  try {
    const commits = execSync('git rev-list --count HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return commits ? `${date}.${commits}` : date;
  } catch {
    return date;
  }
}

const nextConfig: NextConfig = {
  /**
   * Internal workspace packages are consumed as TypeScript source; Next must be
   * told to transpile them — there is no build step for `packages/*`.
   */
  transpilePackages: ['@ycomm/api', '@ycomm/config', '@ycomm/db', '@ycomm/kernel'],
  /**
   * Native / stateful modules must not be bundled into the server chunk —
   * especially PGlite (WASM asset) and pg (connection pool).
   */
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  poweredByHeader: false,
  /**
   * 客户端路由缓存：默认动态页面每次导航都要回服务端取一遍（本站几乎全是
   * force-dynamic），切页会明显发卡。给动态页面 30 秒、静态资源 3 分钟的
   * 客户端复用窗口，导航体感快很多，同时登录态仍由客户端 /me 实时判定。
   */
  experimental: {
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  /** 构建期常量：footer 展示的版本号。 */
  env: {
    NEXT_PUBLIC_APP_VERSION: resolveAppVersion(),
  },
  /**
   * Next's built-in type check spawns a worker process that restricted sandboxes
   * cannot run. Typechecking is ALWAYS enforced separately — `npm run typecheck`
   * in CI and in `npm run verify` — so the escape hatch below only applies where
   * the build environment itself forbids the worker. Never quiet this in Docker
   * builds; leave the env var unset there.
   */
  typescript:
    process.env.SKIP_NEXT_TYPECHECK === '1' ? { ignoreBuildErrors: true } : undefined,
};

export default nextConfig;
