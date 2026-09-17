import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { connect as tcpConnect, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import { createSession, revokeSession } from '@ycomm/identity';
import { loadEnv } from '@ycomm/kernel';
import { createNotification } from '@ycomm/notify';
import { attachRealtimeServer } from './server';

let db: DatabaseHandle;
let server: Server;
let realtime: ReturnType<typeof attachRealtimeServer>;
let url: string;
let token: string;
let userId: string;
const clients: WebSocket[] = [];
const env = loadEnv({ NODE_ENV: 'test', SITE_URL: 'https://community.example' });

beforeAll(async () => {
  db = await createInMemoryDb({ migrationsFolder: fileURLToPath(new URL('../../../../packages/db/migrations', import.meta.url)) });
  await db.runMigrations();
}, 30_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  const [user] = await db.db.insert(schema.users).values({ username: 'ws-user', email: 'ws@example.com', state: 'active' }).returning();
  userId = user!.id;
  token = (await createSession(db.db, { userId })).rawToken;
  server = createServer((_req, res) => res.end('http unchanged'));
  realtime = attachRealtimeServer(server, { env, getDatabase: async () => db.db, heartbeatMs: 50 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/ws`;
});
afterEach(async () => {
  clients.splice(0).forEach((client) => client.terminate());
  await realtime.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.db.delete(schema.notifications);
  await db.db.delete(schema.sessions);
  await db.db.delete(schema.users);
});

function connect(cookie = `${env.SESSION_COOKIE_NAME}=${token}`, options: { origin?: string; path?: string; headers?: Record<string, string>; autoPong?: boolean } = {}) {
  const client = new WebSocket(url + (options.path ?? ''), { headers: { cookie, origin: options.origin ?? 'https://community.example', ...options.headers }, autoPong: options.autoPong });
  clients.push(client);
  return client;
}
async function ready(client: WebSocket) {
  const [data] = await once(client, 'message');
  return JSON.parse(data.toString());
}
async function rejected(client: WebSocket) {
  const [, response] = await once(client, 'unexpected-response');
  response.resume();
  client.on('error', () => {});
  client.terminate();
  return response.statusCode;
}

// A removed auth check, user filter, publish call or cleanup must break these real socket tests.
describe('authenticated notification websocket', () => {
  it('destroys rejected half-open TCP connections', async () => {
    const socket = tcpConnect({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, allowHalfOpen: true });
    await once(socket, 'connect');
    socket.write('GET /api/ws HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nOrigin: https://evil.example\r\n\r\n');
    await once(socket, 'data');
    try {
      await expect.poll(async () => new Promise<number>((resolve, reject) => {
        server.getConnections((error, count) => error ? reject(error) : resolve(count));
      })).toBe(0);
    } finally { socket.destroy(); }
  });
  it('valid Cookie receives ready and ordinary HTTP is unchanged', async () => {
    expect(await ready(connect())).toEqual({ type: 'ready', data: { userId, serverTime: expect.any(String) } });
    expect(await (await fetch(url.replace('ws:', 'http:'))).text()).toBe('http unchanged');
  });
  it.each(['', '__Host-ycomm_session=invalid'])('rejects missing or invalid cookie: %s', async (cookie) => {
    expect(await rejected(connect(cookie))).toBe(401);
  });
  it('rejects expired session', async () => {
    await db.db.update(schema.sessions).set({ expires_at: new Date(0) });
    expect(await rejected(connect())).toBe(401);
  });
  it('rejects revoked session', async () => {
    await revokeSession(db.db, token);
    expect(await rejected(connect())).toBe(401);
  });
  it.each(['banned', 'deleted', 'deleting'] as const)('rejects %s users', async (state) => {
    await db.db.update(schema.users).set({ state }).where(eq(schema.users.id, userId));
    expect(await rejected(connect())).toBe(403);
  });
  it('honours expiry of temporary bans', async () => {
    await db.db.update(schema.users).set({ state: 'banned', banned_until: new Date(0) }).where(eq(schema.users.id, userId));
    expect((await ready(connect())).type).toBe('ready');
  });
  it.each(['https://evil.example', 'null', ''])('rejects disallowed or missing Origin %s', async (origin) => {
    expect(await rejected(connect(undefined, { origin }))).toBe(403);
  });
  it('rejects credentials in query', async () => {
    expect(await rejected(connect(undefined, { path: '?token=secret' }))).toBe(400);
  });
  it('delivers committed notifications to all recipient sockets and no other user', async () => {
    const a = connect(); const b = connect();
    await Promise.all([ready(a), ready(b)]);
    const [other] = await db.db.insert(schema.users).values({ username: 'other', email: 'other@example.com', state: 'active' }).returning();
    const otherToken = (await createSession(db.db, { userId: other!.id })).rawToken;
    const c = connect(`${env.SESSION_COOKIE_NAME}=${otherToken}`);
    await ready(c);
    const received: unknown[] = [];
    c.on('message', (message) => received.push(JSON.parse(message.toString())));
    const delivery = Promise.all([ready(a), ready(b)]);
    await createNotification(db.db, { userId, kind: 'system', title: 'private content' });
    const expected = { type: 'notification.changed', data: { reason: 'created', at: expect.any(String) } };
    expect(await delivery).toEqual([expected, expected]);
    // A subsequent targeted event provides an ordering barrier for the other socket.
    const otherDelivery = ready(c);
    await createNotification(db.db, { userId: other!.id, kind: 'system', title: 'other' });
    await otherDelivery;
    expect(received).toEqual([expected]);
    const closed = once(a, 'close'); a.close(); await closed;
    await expect.poll(() => realtime.connectionCount).toBe(2);
    const remaining = ready(b);
    await createNotification(db.db, { userId, kind: 'system', title: 'after disconnect' });
    expect(await remaining).toEqual(expected);
  });
  it('does not lose events during an in-flight session check', async () => {
    await realtime.close();
    let release: (() => void) | undefined;
    let delay = false;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    realtime = attachRealtimeServer(server, { env, heartbeatMs: 60_000, getDatabase: async () => {
      if (delay) await gate;
      return db.db;
    } });
    const client = connect(); await ready(client);
    delay = true;
    const events: unknown[] = [];
    client.on('message', (message) => events.push(JSON.parse(message.toString())));
    await createNotification(db.db, { userId, kind: 'system', title: 'one' });
    await createNotification(db.db, { userId, kind: 'system', title: 'two' });
    release!();
    await expect.poll(() => events.length).toBe(2);
  });
  it('closes existing sockets after session revocation', async () => {
    const client = connect(); await ready(client);
    const closed = once(client, 'close');
    await revokeSession(db.db, token);
    expect((await closed)[0]).toBe(1008);
    await expect.poll(() => realtime.connectionCount).toBe(0);
  });
  it('cleans up clients which do not pong', async () => {
    const client = connect(undefined, { autoPong: false }); await ready(client);
    await once(client, 'close');
    await expect.poll(() => realtime.connectionCount).toBe(0);
  });
  it('does not accept application messages', async () => {
    const client = connect(); await ready(client);
    const closed = once(client, 'close'); client.send('{"type":"write"}');
    expect((await closed)[0]).toBe(1008);
  });
  it('requires HTTPS in production and trusts forwarded protocol only when configured', async () => {
    await realtime.close();
    const production = loadEnv({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(48), SITE_URL: 'https://community.example', TRUST_PROXY_HEADERS: 'false' });
    realtime = attachRealtimeServer(server, { env: production, getDatabase: async () => db.db });
    expect(await rejected(connect(undefined, { headers: { 'x-forwarded-proto': 'https' } }))).toBe(403);
    await realtime.close();
    realtime = attachRealtimeServer(server, { env: { ...production, TRUST_PROXY_HEADERS: true }, getDatabase: async () => db.db });
    expect(await rejected(connect())).toBe(403);
    expect((await ready(connect(undefined, { headers: { 'x-forwarded-proto': 'https' } }))).type).toBe('ready');
  });
});
