/**
 * `@ycomm/config` — typed, code-reviewed default configuration for the site.
 *
 * Three kinds of configuration live in this package and are loaded in order:
 *
 *   1. **Code defaults** (these files) — capabilities, permission matrix,
 *      thresholds. Changing them is a code review and a redeploy.
 *   2. **Environment** (`packages/kernel/src/config/env.ts`) — deployment
 *      specific values (secrets, origins, branding) that must not be committed.
 *   3. **Settings table** (database) — runtime overrides an operator edits via
 *      the admin dashboard; the code defaults here are the fallback.
 *
 * Secrets of any kind are FORBIDDEN in this package — the entire directory is
 * committed to the public repository.
 */
export * from './access-policy';
export * from './downloads';
export * from './features';
export * from './forums';
export * from './policy';
export * from './roles';
export * from './site';