import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { app } from '@ycomm/api';

/** Preserve byte lengths and ranges through the custom server, without Next compression. */
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
