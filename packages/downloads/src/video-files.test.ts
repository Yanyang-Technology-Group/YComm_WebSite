import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getEnv } from '@ycomm/kernel';
import { prepareVideo } from './video-files';
import { saveLocalFile } from './local-files';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
let previousRoot: string;
let root: string;
let fileName: string;
const bytes = Buffer.from('000000186674797069736f6d0000000069736f6d6d703432', 'hex');
beforeAll(() => {
  previousRoot = getEnv().UPLOAD_DIR;
  root = mkdtempSync(join(tmpdir(), 'ycomm-video-'));
  getEnv().UPLOAD_DIR = root;
  fileName = saveLocalFile(bytes, { kind: 'inlineVideo' }).localPath.split(/[\\/]/).pop()!;
});
afterAll(() => {
  getEnv().UPLOAD_DIR = previousRoot;
  rmSync(root, { recursive: true, force: true });
});
describe('prepared video assets', () => {
  it('deduplicates faststart work, atomically caches it, and preserves the source', async () => {
    vi.mocked(execFile).mockImplementation((_bin: any, args: any, _options: any, callback: any) => {
      expect(args).toContain('+faststart');
      expect(args).toContain('copy');
      writeFileSync(args.at(-1), bytes);
      callback(null);
      return {} as any;
    });
    const [first, second] = await Promise.all([prepareVideo(fileName, 'playback'), prepareVideo(fileName, 'playback')]);
    expect(first).toBe(second);
    expect(first).toBe(`videoPrepared/${fileName}.mp4`);
    expect(existsSync(join(root, first))).toBe(true);
    expect(readFileSync(join(root, 'inlineVideo', fileName))).toEqual(bytes);
    expect(await prepareVideo(fileName, 'playback')).toBe(first);
    expect(execFile).toHaveBeenCalledTimes(1);
  });
  it('falls back to the original when remuxing fails and leaves no partial cache', async () => {
    const name = saveLocalFile(bytes, { kind: 'inlineVideo' }).localPath.split(/[\\/]/).pop()!;
    vi.mocked(execFile).mockImplementation((_bin: any, args: any, _options: any, callback: any) => {
      writeFileSync(args.at(-1), 'partial');
      callback(new Error('codec unsupported'));
      return {} as any;
    });
    expect(await prepareVideo(name, 'playback')).toBe(`inlineVideo/${name}`);
    expect(existsSync(join(root, 'videoPrepared', `${name}.mp4`))).toBe(false);
    await expect(prepareVideo(name, 'poster')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('rejects path traversal before invoking the processor', () => {
    expect(() => prepareVideo('../test.mp4', 'playback')).toThrow();
  });
});
