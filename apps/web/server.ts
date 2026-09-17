import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import next from 'next';
import { attachRealtimeServer, WEBSOCKET_PATH } from '@ycomm/api/realtime';
import { getEnv, logger } from '@ycomm/kernel';

const dev = process.argv.includes('--dev');
const dir = fileURLToPath(new URL('.', import.meta.url));
// Load the same .env files Next normally loads, before getEnv is memoized.
const { loadEnvConfig } = await import('@next/env');
loadEnvConfig(dir, dev);
const env = getEnv();
// Next automatically installs an upgrade listener on httpServer after the first
// HTTP request. Give it a separate, unbound server so that it cannot consume or
// close /api/ws while our async Cookie authentication is in flight.
const nextUpgrades = createServer();
const app = next({ dev, dir, hostname: '0.0.0.0', port: env.PORT, httpServer: nextUpgrades });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer((req, res) => {
  void handle(req, res).catch(() => {
    logger.error('http request failed');
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});
const realtime = attachRealtimeServer(server);
server.on('upgrade', (req, socket, head) => {
  if (req.url?.split('?')[0] === WEBSOCKET_PATH) return;
  if (dev && req.url?.split('?')[0] === '/_next/webpack-hmr' && nextUpgrades.listenerCount('upgrade')) {
    nextUpgrades.emit('upgrade', req, socket, head);
  } else socket.destroy();
});
server.listen(env.PORT, '0.0.0.0', () => logger.info('server listening', { port: env.PORT, dev }));

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  server.close();
  await realtime.close();
  await app.close();
  process.exit(0);
}
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
