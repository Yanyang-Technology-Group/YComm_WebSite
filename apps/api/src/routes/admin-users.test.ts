import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Hono } from 'hono';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import { createSession, resetUserPassword } from '@ycomm/identity';
import { getEnv } from '@ycomm/kernel';
import { errorHandler } from '../error-handler';
import { adminRoutes } from './admin';

let handle: DatabaseHandle;
let app: Hono;
const accounts: Record<string, { id: string; cookie: string }> = {};

beforeAll(async () => {
  handle = await createInMemoryDb({
    migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../packages/db/migrations'),
  });
  await handle.runMigrations();
  (globalThis as unknown as Record<string, unknown>).__ycomm_db_handle__ = Promise.resolve(handle);
  app = new Hono();
  app.onError(errorHandler);
  app.route('/api/admin', adminRoutes());
  for (const role of ['owner', 'admin', 'member'] as const) {
    const [user] = await handle.db.insert(schema.users).values({
      username: `test-${role}`, email: `${role}@example.com`, role, state: 'active',
    }).returning();
    const session = await createSession(handle.db, { userId: user!.id, ttlDays: 1 });
    accounts[role] = { id: user!.id, cookie: `${getEnv().SESSION_COOKIE_NAME}=${session.rawToken}` };
  }
});

afterAll(async () => { await handle.close(); });

describe('Account management visibility', () => {
  it('owner sees their own details; admin list and count exclude protected accounts', async () => {
    for (const role of ['owner', 'admin']) {
      const response = await app.request('/api/admin/users', { headers: { cookie: accounts[role]!.cookie } });
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { users: { id: string; role: string }[]; total: number } };
      expect(body.data.total).toBe(role === 'owner' ? 3 : 1);
      expect(body.data.users.some((user) => user.id === accounts.owner!.id)).toBe(role === 'owner');
      if (role === 'admin') expect(body.data.users.every((user) => user.role === 'member')).toBe(true);
    }
  });

  it('direct badge details and mutations on owner are forbidden to admin', async () => {
    const target = `/api/admin/users/${accounts.owner!.id}/badges`;
    const headers = { cookie: accounts.admin!.cookie };
    expect((await app.request(target, { headers })).status).toBe(403);
    expect((await app.request(`${target}/00000000-0000-4000-8000-000000000000`, { method: 'DELETE', headers })).status).toBe(403);
    expect((await app.request(target, { headers: { cookie: accounts.owner!.cookie } })).status).toBe(200);
  });

  it('owner may reset their own password, while sanctions and role changes remain protected', async () => {
    const owner = accounts.owner!;
    const headers = { cookie: owner.cookie, 'content-type': 'application/json' };
    expect((await app.request(`/api/admin/users/${owner.id}/ban`, { method: 'POST', headers, body: '{}' })).status).toBe(403);
    expect((await app.request(`/api/admin/users/${owner.id}/role`, { method: 'PATCH', headers, body: '{"role":"admin"}' })).status).toBe(403);
    const user = await resetUserPassword(handle.db, { id: owner.id, role: 'owner' }, owner.id, 'New-Password-123');
    expect(user.password_hash).toBeTruthy();
    expect(user.role).toBe('owner');
    expect((await app.request('/api/admin/users', { headers })).status).toBe(401);
  });
});
