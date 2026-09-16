/* global fetch */
// Run after npm run build. Uses disposable PGlite data, never the site's database.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'ycomm-realtime-'));
const portProbe = createServer();
portProbe.listen(0, '127.0.0.1');
await once(portProbe, 'listening');
const port = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
Object.assign(process.env, {
  NODE_ENV: 'production', DATABASE_DRIVER: 'pglite', PGLITE_DATA_DIR: path.join(temp, 'db'),
  SESSION_SECRET: 'smoke-only-secret-with-more-than-thirty-two-characters',
  SITE_URL: 'https://community.example', PORT: String(port), TRUST_PROXY_HEADERS: 'true',
  LOG_LEVEL: 'error', SESSION_COOKIE_NAME: '__Host-ycomm_session',
});
delete process.env.CAPTCHA_ENDPOINT;
const { createDb, schema } = await import('@ycomm/db');
const { hashPassword } = await import('@ycomm/identity');
let child;
let ws;
try {
  const handle = await createDb({ migrationsFolder: path.join(root, 'packages/db/migrations') });
  let member;
  try {
    await handle.runMigrations();
    const password = await hashPassword('smoke-password-123');
    await handle.db.insert(schema.users).values({ username: 'smoke-owner', email: 'owner@example.com', state: 'active', role: 'owner', password_hash: password });
    [member] = await handle.db.insert(schema.users).values({ username: 'smoke-member', email: 'member@example.com', state: 'active', password_hash: password }).returning();
  } finally { await handle.close(); }
  const dev = process.argv.includes('--dev');
  child = spawn(process.execPath, ['--import', 'tsx', 'server.ts', ...(dev ? ['--dev'] : [])], {
    cwd: path.join(root, 'apps/web'), env: { ...process.env, NODE_ENV: dev ? 'development' : 'production' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Keep credentials and framework error payloads out of test output.
  child.stdout.resume(); child.stderr.resume();
  const base = `http://127.0.0.1:${port}`;
  let healthy = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/api/healthz`);
      const body = await response.json();
      if (response.ok && body.db === 'up' && !('data' in body)) { healthy = true; break; }
    } catch { /* server still starting */ }
    await delay(250);
  }
  assert(healthy, 'production healthz did not become ready');
  async function login(username) {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: username, password: 'smoke-password-123', agreeTerms: true, rememberMe: true }),
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert(cookie?.includes('HttpOnly') && cookie.includes('Secure'));
    return cookie.split(';')[0];
  }
  const ownerCookie = await login('smoke-owner');
  const memberCookie = await login('smoke-member');
  ws = new WebSocket(`${base.replace('http:', 'ws:')}/api/ws`, { headers: {
    Cookie: memberCookie, Origin: 'https://community.example', 'X-Forwarded-Proto': 'https',
  } });
  const message = async () => JSON.parse((await once(ws, 'message'))[0].toString());
  const ready = await message();
  assert.equal(ready.type, 'ready'); assert.equal(ready.data.userId, member.id);
  const event = message();
  const changed = await fetch(`${base}/api/admin/users/${member.id}/mute`, {
    method: 'POST', headers: { Cookie: ownerCookie, 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'smoke-test' }),
  });
  assert.equal(changed.status, 200);
  const hint = await Promise.race([event, delay(10_000, null, { ref: false })]);
  assert.deepEqual(hint && { ...hint, data: { ...hint.data, at: 'time' } }, { type: 'notification.changed', data: { reason: 'created', at: 'time' } });
  const unread = await fetch(`${base}/api/notifications/unread-count`, { headers: { Cookie: memberCookie } });
  assert.deepEqual(await unread.json(), { ok: true, data: { count: 1 } });
  const closed = once(ws, 'close'); ws.close(); await closed;
  console.log(`${dev ? 'Development' : 'Production'} smoke passed: healthz, REST login Cookie, ready, REST mutation -> notification.changed, authoritative unread count.`);
} finally {
  ws?.terminate();
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
  await rm(temp, { recursive: true, force: true });
}
