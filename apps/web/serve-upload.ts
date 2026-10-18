import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { app } from '@ycomm/api';
import { baselineSecurityHeaders } from './security-headers';

/**
 * 上传统媒体直出（Preserve byte lengths and ranges through the custom server,
 * without Next compression）。
 *
 * 这条路径在 server.ts 里分流，**不经过 Next**：middleware 的安全头不会生效，
 * 所以基础安全头与长缓存头必须在这里自己补上。
 */
export async function serveUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const controller = new AbortController();
  const abort = () => { if (!res.writableFinished) controller.abort(); };
  res.on('close', abort);
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    const response = await app.fetch(new Request(new URL(req.url ?? '/', 'http://localhost'), {
      method: req.method ?? 'GET', headers, signal: controller.signal,
    }));
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    // 只补基础安全头：`Cache-Control` 必须沿用上传路由自己设的（它带 no-transform，
    // 是字节范围与 Content-Length 能原样透传的前提），这里绝不能覆盖。
    for (const [name, value] of Object.entries(baselineSecurityHeaders())) {
      res.setHeader(name, value);
    }
    if (!response.body || req.method === 'HEAD') {
      await response.body?.cancel();
      res.end();
      return;
    }
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), res);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    res.off('close', abort);
  }
}
