import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { getEnv, newId, errors } from '@ycomm/kernel';

const pending = new Map<string, Promise<string>>();
const queues: Record<'playback' | 'poster', Promise<unknown>> = { playback: Promise.resolve(), poster: Promise.resolve() };

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolveRun, reject) => {
    execFile(/* turbopackIgnore: true */ process.env.FFMPEG_PATH || 'ffmpeg', args, { timeout: 30_000, maxBuffer: 256 * 1024 }, (error) => {
      if (error) reject(error); else resolveRun();
    });
  });
}

/** Copy MP4/MOV streams with their index at the front; generate small reusable covers. */
export function prepareVideo(fileName: string, kind: 'playback' | 'poster'): Promise<string> {
  if (!/^[A-Za-z0-9_-]{8,64}\.(mp4|webm|mov)$/i.test(fileName)) throw errors.notFound('视频不存在');
  const root = resolve(getEnv().UPLOAD_DIR);
  const source = resolve(root, 'inlineVideo', fileName);
  if (!existsSync(source)) throw errors.notFound('视频不存在');
  if (kind === 'playback' && fileName.endsWith('.webm')) return Promise.resolve(`inlineVideo/${fileName}`);
  const relative = `videoPrepared/${fileName}.${kind === 'poster' ? 'jpg' : 'mp4'}`;
  const target = resolve(root, relative);
  if (existsSync(target)) return Promise.resolve(relative);
  const key = `${root}${sep}${relative}`;
  const active = pending.get(key);
  if (active) return active;
  const task = queues[kind].then(async () => {
    if (existsSync(target)) return relative;
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${newId()}.tmp`;
    try {
      await runFfmpeg(['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
        ...(kind === 'playback'
          ? ['-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4']
          : ['-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', '-threads', '1', '-f', 'image2']), temporary]);
      await rename(temporary, target);
      return relative;
    } catch {
      if (kind === 'playback') return `inlineVideo/${fileName}`;
      throw errors.notFound('视频封面暂不可用');
    } finally {
      await unlink(temporary).catch(() => {});
    }
  });
  // Cover work must not delay a viewer who has pressed play.
  queues[kind] = task.catch(() => {});
  pending.set(key, task);
  void task.finally(() => pending.delete(key)).catch(() => {});
  return task;
}
