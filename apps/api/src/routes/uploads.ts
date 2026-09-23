import { Hono, type Context } from 'hono';
import { Readable } from 'node:stream';
import { errors } from '@ycomm/kernel';
import { openLocalFile, saveLocalFile } from '@ycomm/downloads';
import type { AppVariables } from '../context';
import { requireAuth, sessionAuth } from '../middleware/session';
import { rateLimitByUser } from '../middleware/rate-limit';
import { parseRange } from '../middleware/range';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

/**
 * 论坛内嵌图片 / 视频上传与读取。
 *
 * - `POST /api/uploads/images`：登录用户上传图片（magic-byte 校验 + 白名单 + ≤50MB）。
 * - `POST /api/uploads/videos`：同上，视频（mp4 / webm / mov，≤50MB）。
 * - `GET  /api/uploads/{images,videos}/:file`：随机文件名，公开可读，长缓存；支持 Range（视频可拖动）。
 */
export function uploadRoutes(): Hono<{ Variables: AppVariables }> {
  const router = new Hono<{ Variables: AppVariables }>();
  router.use('*', sessionAuth);

  router.post('/images', requireAuth, rateLimitByUser('uploadImage'), async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') {
      throw errors.validation({ issues: [{ path: 'file', message: '缺少图片文件' }] });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = saveLocalFile(buffer, { kind: 'inlineImage', originalName: file.name });
    const fileName = saved.localPath.split(/[\\/]/).pop() ?? '';
    return c.json(
      {
        ok: true,
        data: { url: `/api/uploads/images/${fileName}`, mime: saved.mime, size: saved.sizeBytes },
      },
      201,
    );
  });

  router.post('/videos', requireAuth, rateLimitByUser('uploadVideo'), async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') {
      throw errors.validation({ issues: [{ path: 'file', message: '缺少视频文件' }] });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = saveLocalFile(buffer, { kind: 'inlineVideo', originalName: file.name });
    const fileName = saved.localPath.split(/[\\/]/).pop() ?? '';
    return c.json(
      {
        ok: true,
        data: { url: `/api/uploads/videos/${fileName}`, mime: saved.mime, size: saved.sizeBytes },
      },
      201,
    );
  });

  router.get('/images/:file', async (c) => {
    const name = c.req.param('file');
    // 只接受「随机名 + 图片扩展名」，杜绝路径穿越
    if (!/^[A-Za-z0-9_-]{8,64}\.(png|jpe?g|webp|gif)$/i.test(name)) {
      throw errors.notFound('图片不存在');
    }
    return streamUpload(c, `inlineImage/${name}`, name);
  });

  router.get('/videos/:file', async (c) => {
    const name = c.req.param('file');
    if (!/^[A-Za-z0-9_-]{8,64}\.(mp4|webm|mov)$/i.test(name)) {
      throw errors.notFound('视频不存在');
    }
    return streamUpload(c, `inlineVideo/${name}`, name);
  });

  return router;
}

/** 按 Range 返回上传目录里的文件（图片/视频共用，视频靠它支持拖动进度条）。 */
function streamUpload(c: Context, localPath: string, fileName: string): Response {
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  const probe = openLocalFile(localPath);
  const range = parseRange(c.req.header('range'), probe.size);
  let file = probe;
  if (range) {
    // 先拿到总大小才能算区间；把探测用的句柄关掉再按区间重开，避免泄漏 fd
    probe.stream.destroy();
    file = openLocalFile(localPath, range);
  }

  const headers: Record<string, string> = {
    'content-type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
    'cache-control': 'public, max-age=31536000, immutable',
    'accept-ranges': 'bytes',
  };

  if (range) {
    headers['content-range'] = `bytes ${file.start}-${file.end}/${file.size}`;
    headers['content-length'] = String(file.end - file.start + 1);
    return new Response(Readable.toWeb(file.stream) as ReadableStream, { status: 206, headers });
  }

  headers['content-length'] = String(file.size);
  return new Response(Readable.toWeb(file.stream) as ReadableStream, { headers });
}
