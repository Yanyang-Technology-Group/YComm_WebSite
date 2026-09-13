import { Hono } from 'hono';
import { Readable } from 'node:stream';
import { errors } from '@ycomm/kernel';
import { openLocalFile, saveLocalFile } from '@ycomm/downloads';
import type { AppVariables } from '../context';
import { requireAuth, sessionAuth } from '../middleware/session';
import { rateLimitByUser } from '../middleware/rate-limit';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/**
 * 论坛内嵌图片上传/读取。
 *
 * - `POST /api/uploads/images`：登录用户上传（magic-byte 校验 + 类型白名单 + 大小上限）。
 * - `GET  /api/uploads/images/:file`：随机文件名，公开可读，长缓存。
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

  router.get('/images/:file', async (c) => {
    const name = c.req.param('file');
    // 只接受「随机名 + 图片扩展名」，杜绝路径穿越
    if (!/^[A-Za-z0-9_-]{8,64}\.(png|jpe?g|webp|gif)$/i.test(name)) {
      throw errors.notFound('图片不存在');
    }
    const opened = openLocalFile(`inlineImage/${name}`);
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
    return new Response(Readable.toWeb(opened.stream) as ReadableStream, {
      headers: {
        'content-type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
        'content-length': String(opened.size),
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  });

  return router;
}
