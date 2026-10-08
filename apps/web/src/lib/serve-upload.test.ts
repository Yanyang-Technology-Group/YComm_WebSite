import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getEnv } from '@ycomm/kernel';
import { serveUpload } from '../../serve-upload';

vi.mock('@ycomm/api', async () => {
  const { Hono } = await import('hono');
  const { uploadRoutes } = await import('../../../api/src/routes/uploads');
  const { errorHandler } = await import('../../../api/src/error-handler');
  return { app: new Hono().onError(errorHandler).route('/api/uploads', uploadRoutes()) };
});
let server: Server;
let root: string;
let previousRoot: string;
let origin: string;
let path: string;
const bytes = Buffer.concat([Buffer.from('000000186674797069736f6d0000000069736f6d6d703432', 'hex'), Buffer.alloc(512 * 1024)]);
beforeAll(async () => {
  previousRoot = getEnv().UPLOAD_DIR;
  root = mkdtempSync(join(tmpdir(), 'ycomm-media-http-'));
  getEnv().UPLOAD_DIR = root;
  mkdirSync(join(root, 'inlineVideo'));
  writeFileSync(join(root, 'inlineVideo', 'test-video-123.mp4'), bytes);
  path = '/api/uploads/videos/test-video-123.mp4';
  server = createServer((req, res) => { void serveUpload(req, res).catch(() => res.destroy()); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  getEnv().UPLOAD_DIR = previousRoot;
  rmSync(root, { recursive: true, force: true });
});
describe('media delivery through the actual HTTP server', () => {
  it('preserves content length for full, HEAD, and partial requests', async () => {
    const full = await fetch(origin + path);
    expect(full.headers.get('content-length')).toBe(String(bytes.length));
    expect(full.headers.get('transfer-encoding')).toBeNull();
    expect(full.headers.get('cache-control')).toContain('no-transform');
    expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);
    const head = await fetch(origin + path, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(bytes.length));
    expect(await head.text()).toBe('');
    const partial = await fetch(origin + path, { headers: { range: 'bytes=0-1023' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-length')).toBe('1024');
    expect(partial.headers.get('content-range')).toBe(`bytes 0-1023/${bytes.length}`);
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(bytes.subarray(0, 1024));
  });
});
