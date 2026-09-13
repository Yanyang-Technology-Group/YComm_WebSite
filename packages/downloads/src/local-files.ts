import { existsSync, mkdirSync, statSync, createReadStream, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { getEnv, newId, errors } from '@ycomm/kernel';
import { UPLOADS, type UploadKind, type UploadRule } from '@ycomm/config';

/**
 * Magic-byte sniffing for the upload allow-list.
 *
 * The extension is never trusted on its own — a renamed .exe is not an "image".
 * Anything that does not match here is rejected outright.
 */
export function sniffMime(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'application/zip';
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/zip': '.zip',
  'application/pdf': '.pdf',
};

export interface SavedFile {
  /** Path relative to UPLOAD_DIR, stored in download_links.local_path. */
  localPath: string;
  /** Original name for Content-Disposition. */
  fileName: string;
  sizeBytes: number;
  mime: string;
}

/**
 * Persist an uploaded file for the download area.
 *
 * Random file name, verified magic bytes, size capped by the config rule. The
 * directory is outside the web root and never served statically — everything
 * goes through the gated fetch route.
 */
export function saveLocalFile(buffer: Buffer, input: { kind: UploadKind; originalName?: string }): SavedFile {
  const rule: UploadRule = UPLOADS[input.kind];
  if (!rule) {
    throw errors.validation({ issues: [{ path: 'kind', message: '未知的上传类型' }] });
  }
  if (buffer.length > rule.maxBytes) {
    throw errors.validation({
      issues: [{ path: 'file', message: `文件超过大小限制（${Math.round(rule.maxBytes / 1024 / 1024)}MB）` }],
    });
  }
  const mime = sniffMime(buffer);
  if (!mime || !rule.mimeTypes.includes(mime)) {
    throw errors.validation({ issues: [{ path: 'file', message: '文件类型不被允许（按内容识别，不按扩展名）' }] });
  }
  // Keep the extension from the message only when it matches the sniffed type.
  const ext = EXTENSION_BY_MIME[mime] ?? extname(input.originalName ?? '').toLowerCase();
  const fileName = `${newId()}${ext}`;
  // 按上传类型分目录：resource 沿用历史的 resources/，其余用类型名（如 inlineImage/）
  const folder = input.kind === 'resource' ? 'resources' : input.kind;
  const fullDir = join(getEnv().UPLOAD_DIR, folder);
  mkdirSync(fullDir, { recursive: true });
  writeFileSync(join(fullDir, fileName), buffer);

  return {
    localPath: join(folder, fileName),
    fileName: basename(input.originalName ?? fileName),
    sizeBytes: buffer.length,
    mime,
  };
}

export interface OpenedLocalFile {
  stream: Readable;
  size: number;
  start: number;
  end: number;
}

/**
 * Open a stored local file for streaming with Range support.
 *
 * Path traversal guard: the stored path must resolve strictly inside the
 * uploads root.
 */
export function openLocalFile(localPath: string, range?: { start: number; end: number }): OpenedLocalFile {
  const root = resolve(getEnv().UPLOAD_DIR);
  const full = resolve(root, localPath);
  if (!full.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))) {
    throw errors.notFound('文件不存在');
  }
  if (!existsSync(full)) {
    throw errors.notFound('文件不存在');
  }
  const size = statSync(full).size;
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  return {
    stream: createReadStream(full, { start, end }),
    size,
    start,
    end,
  };
}