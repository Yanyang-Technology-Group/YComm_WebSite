import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { TLSSocket } from 'node:tls';
import { WebSocket, WebSocketServer } from 'ws';
import { parse } from 'hono/utils/cookie';
import { getDb, type Db } from '@ycomm/db';
import { expireSanctions, findSessionByToken } from '@ycomm/identity';
import { getEnv, logger, type Env } from '@ycomm/kernel';
import { getNotificationEventBus, type NotificationEventBus, type RealtimeEvent } from '@ycomm/notify';

export type { RealtimeEvent } from '@ycomm/notify';
export const WEBSOCKET_PATH = '/api/ws';

interface Options {
  env?: Env;
  getDatabase?: () => Promise<Db>;
  bus?: NotificationEventBus;
  heartbeatMs?: number;
}
interface Client {
  ws: WebSocket;
  userId: string;
  token: string;
  alive: boolean;
  queued: number;
  checking?: Promise<boolean>;
}
class Rejection extends Error {
  constructor(readonly status: number, readonly reason: string) { super(reason); }
}

function allowedOrigin(origin: string | undefined, env: Env): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) return false;
    if (env.SITE_URL) return origin === new URL(env.SITE_URL).origin;
    return env.NODE_ENV !== 'production' && ['http:', 'https:'].includes(parsed.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  } catch { return false; }
}

/** Node-only upgrade owner. Ordinary requests remain entirely with Next/Hono. */
export function attachRealtimeServer(server: Server, options: Options = {}) {
  const env = options.env ?? getEnv();
  const database = options.getDatabase ?? (async () => (await getDb()).db);
  const bus = options.bus ?? getNotificationEventBus();
  if (env.NODE_ENV === 'production' && (!env.SITE_URL || new URL(env.SITE_URL).protocol !== 'https:')) {
    throw new Error('WebSocket production requires an HTTPS SITE_URL');
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const users = new Map<string, Set<Client>>();
  const pending = new Set<Duplex>();
  let stopped = false;
  let count = 0;

  async function authenticate(token: string): Promise<string> {
    const db = await database();
    const found = await findSessionByToken(db, token);
    if (!found) throw new Rejection(401, 'session_invalid');
    const user = await expireSanctions(db, found.user);
    if (!['active', 'unverified', 'muted'].includes(user.state)) throw new Rejection(403, 'user_unavailable');
    return user.id;
  }
  function closeClient(client: Client, code: number, reason: string) {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    client.ws.close(code, reason);
    // Closing peers may never acknowledge; bound cleanup time independently of pong.
    const timer = setTimeout(() => client.ws.terminate(), 1000);
    timer.unref();
    client.ws.once('close', () => clearTimeout(timer));
  }
  function validate(client: Client): Promise<boolean> {
    if (!client.checking) {
      client.checking = authenticate(client.token).then((id) => {
        if (id !== client.userId) throw new Rejection(401, 'session_invalid');
        return true;
      }).catch((error: unknown) => {
        closeClient(client, error instanceof Rejection ? 1008 : 1011,
          error instanceof Rejection ? 'session_invalid' : 'authentication_unavailable');
        logger.info('websocket session ended', { userId: client.userId, reason: error instanceof Rejection ? error.reason : 'authentication_unavailable' });
        return false;
      }).finally(() => { client.checking = undefined; });
    }
    return client.checking;
  }
  function send(client: Client, event: RealtimeEvent) {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    if (client.ws.bufferedAmount > 64 * 1024) {
      closeClient(client, 1013, 'slow_consumer');
      return;
    }
    client.ws.send(JSON.stringify(event), (error) => { if (error) client.ws.terminate(); });
  }
  const unsubscribe = bus.subscribe((userId, event) => {
    for (const client of users.get(userId) ?? []) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      if (client.queued >= 64) { closeClient(client, 1013, 'slow_consumer'); continue; }
      client.queued++;
      // Share the in-flight check, but preserve every refresh event.
      void validate(client).then((valid) => { if (valid) send(client, event); })
        .finally(() => { client.queued--; });
    }
  });
  function reject(socket: Duplex, status: number, reason: string) {
    logger.info('websocket rejected', { status, reason, connections: count });
    if (!socket.destroyed) {
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy());
    }
  }
  async function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    // HMR is owned by the custom server's Next upgrade handler.
    if (req.url?.split('?')[0] !== WEBSOCKET_PATH) return;
    const onError = () => socket.destroy();
    socket.on('error', onError);
    if (stopped || pending.size >= 100 || count >= 1000) {
      reject(socket, 503, 'capacity'); return;
    }
    pending.add(socket);
    const timeout = setTimeout(() => { socket.destroy(); }, 5000);
    timeout.unref();
    try {
      if (req.url !== WEBSOCKET_PATH) throw new Rejection(400, 'query_not_allowed');
      if (!allowedOrigin(req.headers.origin, env)) throw new Rejection(403, 'origin');
      if (env.NODE_ENV === 'production' && !(req.socket as TLSSocket).encrypted &&
          !(env.TRUST_PROXY_HEADERS && req.headers['x-forwarded-proto'] === 'https')) {
        throw new Rejection(403, 'https_required');
      }
      const token = parse(req.headers.cookie ?? '')[env.SESSION_COOKIE_NAME];
      if (!token) throw new Rejection(401, 'cookie_missing');
      const userId = await authenticate(token);
      if (stopped || socket.destroyed) return;
      if ((users.get(userId)?.size ?? 0) >= 8 || count >= 1000) throw new Rejection(429, 'connection_limit');
      wss.handleUpgrade(req, socket, head, (ws) => {
        const client: Client = { ws, userId, token, alive: true, queued: 0 };
        const group = users.get(userId) ?? new Set<Client>();
        group.add(client); users.set(userId, group); count++;
        ws.on('pong', () => { client.alive = true; });
        ws.on('message', () => closeClient(client, 1008, 'server_events_only'));
        ws.on('error', () => { logger.warn('websocket error', { userId }); ws.terminate(); });
        ws.once('close', (code) => {
          group.delete(client); count--; client.token = '';
          if (group.size === 0) users.delete(userId);
          logger.info('websocket disconnected', { userId, code, connections: count });
        });
        logger.info('websocket authenticated', { userId, connections: count });
        send(client, { type: 'ready', data: { userId, serverTime: new Date().toISOString() } });
      });
    } catch (error) {
      reject(socket, error instanceof Rejection ? error.status : 503,
        error instanceof Rejection ? error.reason : 'authentication_unavailable');
    } finally {
      clearTimeout(timeout); pending.delete(socket);
      socket.removeListener('error', onError);
    }
  }
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => { void upgrade(req, socket, head); };
  server.on('upgrade', onUpgrade);
  const interval = setInterval(() => {
    for (const group of users.values()) for (const client of group) {
      if (!client.alive) { client.ws.terminate(); continue; }
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      client.alive = false; client.ws.ping();
      void validate(client);
    }
  }, options.heartbeatMs ?? 30_000);
  interval.unref();

  return {
    get connectionCount() { return count; },
    async close() {
      if (stopped) return;
      stopped = true;
      clearInterval(interval); unsubscribe(); server.removeListener('upgrade', onUpgrade);
      for (const socket of pending) socket.destroy();
      pending.clear();
      for (const group of users.values()) for (const client of group) closeClient(client, 1001, 'server_shutdown');
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
