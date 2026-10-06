import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { getEnv } from '@ycomm/kernel';
import { errorHandler } from '../error-handler';
import { uploadRoutes } from './uploads';

vi.mock('../middleware/session', async () => {
  const { createMiddleware } = await import('hono/factory');
  return {
    sessionAuth: createMiddleware(async (c, next) => {
      if (c.req.header('cookie') === 'test-session=member') c.set('auth', { userId: 'upload-member' });
      await next();
    }),
    requireAuth: createMiddleware(async (c, next) => {
      if (!c.get('auth')) return c.json({ ok: false }, 401);
      await next();
    }),
  };
});

const app = new Hono().onError(errorHandler).route('/api/uploads', uploadRoutes());
const fixtures = [
  ['images', 'test.png', 'image/png', Buffer.from('89504e470d0a1a0a00000000', 'hex')],
  ['videos', 'test.mp4', 'video/mp4', Buffer.from('000000186674797069736f6d0000000069736f6d6d703432', 'hex')],
  ['videos', 'test.webm', 'video/webm', Buffer.from('1a45dfa300000000', 'hex')],
  ['videos', 'test.mov', 'video/quicktime', Buffer.from('00000014667479707174202000000000', 'hex')],
] as const;
let previousRoot: string;
let uploadRoot: string;
beforeAll(() => {
  previousRoot = getEnv().UPLOAD_DIR;
  uploadRoot = mkdtempSync(join(tmpdir(), 'ycomm-upload-test-'));
  getEnv().UPLOAD_DIR = uploadRoot;
});
afterAll(() => {
  getEnv().UPLOAD_DIR = previousRoot;
  rmSync(uploadRoot, { recursive: true, force: true });
});

describe('uploaded media HTTP round trip', () => {
  it.each(fixtures)('%s: %s is immediately readable and supports HEAD and Range', async (kind, name, mime, bytes) => {
    const form = new FormData();
    form.append('file', new File([bytes], name, { type: mime }));
    const uploaded = await app.request(`/api/uploads/${kind}`, {
      method: 'POST', headers: { cookie: 'test-session=member' }, body: form,
    });
    expect(uploaded.status).toBe(201);
    const { data } = await uploaded.json() as { data: { url: string; mime: string; size: number } };
    expect(data).toMatchObject({ mime, size: bytes.length });
    const full = await app.request(data.url);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe(mime);
    expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);
    const head = await app.request(data.url, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(bytes.length));
    expect(await head.text()).toBe('');
    const partial = await app.request(data.url, { headers: { range: 'bytes=4-7' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe(`bytes 4-7/${bytes.length}`);
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(bytes.subarray(4, 8));
  });

  it('rejects unauthenticated uploads, wrong media types and traversal', async () => {
    expect((await app.request('/api/uploads/videos', { method: 'POST' })).status).toBe(401);
    const form = new FormData();
    form.append('file', new File([fixtures[0][3]], 'renamed.mp4', { type: 'video/mp4' }));
    expect((await app.request('/api/uploads/videos', {
      method: 'POST', headers: { cookie: 'test-session=member' }, body: form,
    })).status).toBe(400);
    for (const name of ['missing-file.mp4', 'bad.mp4', '%2e%2e%5csecret.mp4']) {
      const missing = await app.request(`/api/uploads/videos/${name}`);
      expect(missing.status).toBe(404);
      expect(missing.headers.get('cache-control')).toBe('no-store');
    }
  });
});
