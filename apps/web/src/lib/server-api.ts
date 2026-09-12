import { cookies } from 'next/headers';
import { app } from '@ycomm/api';

/**
 * Server-component API access: run the in-process Hono app with the incoming
 * cookie so session state is honored — same boundary as the browser, zero
 * network overhead.
 */
export async function apiReq(path: string, init?: RequestInit): Promise<Response> {
  const cookieHeader = (await cookies()).toString();
  return app.request(path, {
    ...init,
    headers: {
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export async function apiGet<T>(path: string): Promise<{ ok: boolean; data?: T; status?: number }> {
  const response = await apiReq(path);
  const json = (await response.json().catch(() => null)) as { ok: boolean; data?: T } | null;
  return { ok: response.ok && (json?.ok ?? false), data: json?.data, status: response.status };
}