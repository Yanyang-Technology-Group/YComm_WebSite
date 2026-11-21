import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import { createSession } from '@ycomm/identity';
import { createCard, createOneTimeLink, redeemOneTimeLink, updateCard, type CardRow } from '@ycomm/downloads';
import { getEnv, hashToken } from '@ycomm/kernel';
import { errorHandler } from '../error-handler';
import { adminRoutes } from './admin';
import { downloadsRoutes } from './downloads';

let handle: DatabaseHandle;
let app: Hono;
let card: CardRow;
const cookies: Record<string, string> = {};
const sourceUrl = 'https://source.example/hidden/archive.zip';
const fetchMock = vi.fn<typeof fetch>();

beforeAll(async () => {
  handle = await createInMemoryDb({ migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../packages/db/migrations') });
  await handle.runMigrations();
  vi.stubGlobal('__ycomm_db_handle__', Promise.resolve(handle));
  app = new Hono().onError(errorHandler).route('/api/admin', adminRoutes()).route('/api/downloads', downloadsRoutes());
  for (const role of ['owner', 'admin', 'member'] as const) {
    const [user] = await handle.db.insert(schema.users).values({ username: `once-${role}`, email: `${role}@example.com`, role, state: 'active', birth_date: '2000-01-01' }).returning();
    const session = await createSession(handle.db, { userId: user!.id });
    cookies[role] = `${getEnv().SESSION_COOKIE_NAME}=${session.rawToken}`;
  }
});

beforeEach(async () => {
  card = await createCard(handle.db, { parentId: null, title: 'Archive', kind: 'redirect', visibility: 'login', redirectUrl: sourceUrl, oneTimeLinkEnabled: true }, 'owner');
  fetchMock.mockReset().mockImplementation(async (_target, init) => new Response(init?.method === 'HEAD' ? null : 'archive-data', {
    status: 200, headers: { 'content-type': 'application/zip', 'content-length': '12', 'accept-ranges': 'bytes' },
  }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await handle.db.delete(schema.downloadCards);
});
afterAll(async () => { await handle.close(); vi.unstubAllGlobals(); });

function request(url: string, role?: string, method = 'GET', body?: unknown) {
  return app.request(url, { method, headers: { ...(role ? { cookie: cookies[role]! } : {}), 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function issue(role = 'member') {
  const response = await request(`/api/downloads/cards/${card.id}/one-time-links`, role, 'POST');
  expect(response.status).toBe(201);
  const { data } = await response.json();
  expect(JSON.stringify(data)).not.toContain('source.example');
  return data as { url: string; expiresAt: string };
}

describe('one-time download links', () => {
  it('defaults the button off and lets staff configure it through the admin API', async () => {
    const created = await request('/api/admin/cards', 'owner', 'POST', { title: 'Default off', kind: 'redirect', redirectUrl: sourceUrl });
    expect(created.status).toBe(201);
    const { data } = await created.json();
    expect(data.card.oneTimeLinkEnabled).toBe(false);
    for (const role of ['admin', 'owner']) {
      const updated = await request(`/api/admin/cards/${data.card.id}`, role, 'PATCH', { oneTimeLinkEnabled: true });
      expect(updated.status).toBe(200);
      expect((await updated.json()).data.card.oneTimeLinkEnabled).toBe(true);
    }
    expect((await request(`/api/admin/cards/${card.id}`, 'member', 'PATCH', { oneTimeLinkEnabled: true })).status).toBe(403);
  });

  it('copies a one-hour URL, accepts cookie-free HEAD probes, and allows exactly one GET', async () => {
    const { url, expiresAt } = await issue();
    expect(new Date(expiresAt).getTime() - Date.now()).toBeGreaterThan(3_590_000);
    expect(new Date(expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(3_600_000);
    for (let i = 0; i < 2; i++) expect((await request(url, undefined, 'HEAD')).status).toBe(200);
    const response = await request(url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('archive-data');
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('content-disposition')).toContain('archive.zip');
    expect((await request(url)).status).toBe(410);
    expect((await request(url, undefined, 'HEAD')).status).toBe(410);
    const [row] = await handle.db.select().from(schema.downloadCardTickets);
    const raw = new URL(url, 'https://site.example').searchParams.get('token')!;
    expect(row!.token_hash).toBe(hashToken(raw));
    expect(row!.token_hash).not.toBe(raw);
    expect(row!.consumed_at).toBeInstanceOf(Date);
  });

  it('requires current card visibility and an enabled button to issue a link', async () => {
    expect((await request(`/api/downloads/cards/${card.id}/one-time-links`, undefined, 'POST')).status).toBe(404);
    await updateCard(handle.db, card.id, { visibility: 'staff' });
    expect((await request(`/api/downloads/cards/${card.id}/one-time-links`, 'member', 'POST')).status).toBe(404);
    await issue('owner');
    await updateCard(handle.db, card.id, { oneTimeLinkEnabled: false });
    expect((await request(`/api/downloads/cards/${card.id}/one-time-links`, 'owner', 'POST')).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps public cards usable for guests and returns the button setting without the origin URL', async () => {
    await updateCard(handle.db, card.id, { visibility: 'public' });
    const listed = await request('/api/downloads/cards');
    const { data } = await listed.json();
    expect(data.cards[0]).toMatchObject({ oneTimeLinkEnabled: true, redirectUrl: null });
    expect((await request(`/api/downloads/cards/${card.id}/one-time-links`, undefined, 'POST')).status).toBe(201);
  });

  it('rejects expired, malformed, disabled and deleted links', async () => {
    const { token } = await createOneTimeLink(handle.db, card.id);
    const url = `/api/downloads/one-time?token=${token}`;
    await handle.db.update(schema.downloadCardTickets).set({ expires_at: new Date(Date.now() - 1) });
    expect((await request(url)).status).toBe(410);
    expect((await request('/api/downloads/one-time?token=invalid')).status).toBe(410);
    const disabled = await createOneTimeLink(handle.db, card.id);
    await updateCard(handle.db, card.id, { oneTimeLinkEnabled: false });
    expect((await request(`/api/downloads/one-time?token=${disabled.token}`)).status).toBe(410);
    const deleted = await createOneTimeLink(handle.db, card.id);
    await handle.db.delete(schema.downloadCards).where(eq(schema.downloadCards.id, card.id));
    expect((await request(`/api/downloads/one-time?token=${deleted.token}`)).status).toBe(410);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('atomically admits only one concurrent download', async () => {
    const { token } = await createOneTimeLink(handle.db, card.id);
    const url = `/api/downloads/one-time?token=${token}`;
    const responses = await Promise.all([request(url), request(url), request(url)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 410, 410]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('forwards the first Range request and consumes the link before any second request', async () => {
    const { token } = await createOneTimeLink(handle.db, card.id);
    fetchMock.mockResolvedValue(new Response('data', { status: 206, headers: { 'content-range': 'bytes 8-11/12' } }));
    const response = await app.request(`/api/downloads/one-time?token=${token}`, { headers: { range: 'bytes=8-11' } });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 8-11/12');
    expect(fetchMock).toHaveBeenCalledWith(new URL(sourceUrl), expect.objectContaining({ headers: expect.objectContaining({ range: 'bytes=8-11' }), redirect: 'follow' }));
    expect(await redeemOneTimeLink(handle.db, token)).toBeNull();
  });

  it('does not relay upstream error pages that contain the source URL', async () => {
    const { token } = await createOneTimeLink(handle.db, card.id);
    fetchMock.mockResolvedValue(new Response(`Error at ${sourceUrl}`, { status: 404 }));
    const response = await request(`/api/downloads/one-time?token=${token}`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(sourceUrl);
  });
});
