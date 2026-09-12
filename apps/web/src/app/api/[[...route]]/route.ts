import { handle } from 'hono/vercel';
import { app } from '@ycomm/api';

/**
 * Mounts the Hono application at `/api/*`.
 *
 * The Hono app already prefixes its routes with `/api`, which keeps it usable
 * standalone later; this catch-all simply forwards everything of that prefix.
 */
export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';