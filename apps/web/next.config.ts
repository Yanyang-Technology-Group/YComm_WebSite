import type { NextConfig } from 'next';

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