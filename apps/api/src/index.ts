/**
 * `@ycomm/api` — the thin HTTP layer.
 *
 * Rule of the house: routes here do three things only — parse/validate input,
 * call into `@ycomm/*` domain packages, and serialize the response. Business
 * rules live in the domain packages, never here.
 */
export { APP_NAME, APP_VERSION } from './version';
export { createApp } from './app';
export type AppType = ReturnType<typeof createApp>;

// Process-wide singleton so Next's catch-all route and in-process callers
// (`api.request(...)`) share one instance.
import { createApp } from './app';
export const app = createApp();