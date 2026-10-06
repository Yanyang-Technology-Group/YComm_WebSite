import { describe, expect, it } from 'vitest';
// @ts-expect-error Node entrypoint is deliberately plain JS.
import { hasUploadMount } from './check-upload-storage.mjs';

describe('container upload storage', () => {
  const root = '1 0 0:1 / / rw - overlay overlay rw\n';
  it('rejects the disposable container layer and unrelated/prefix mounts', () => {
    expect(hasUploadMount('/app/uploads', root)).toBe(false);
    expect(hasUploadMount('/app/uploads', root + '2 1 0:2 / /app/uploads-old rw - ext4 /dev/x rw')).toBe(false);
  });
  it('accepts named volumes, bind mounts and a persistent parent', () => {
    for (const mount of ['/app/uploads', '/app']) {
      expect(hasUploadMount('/app/uploads', root + `2 1 0:2 / ${mount} rw - ext4 /dev/x rw`)).toBe(true);
    }
    expect(hasUploadMount('/data/my uploads', root + '2 1 0:2 / /data/my\\040uploads rw - ext4 /dev/x rw')).toBe(true);
  });
});
