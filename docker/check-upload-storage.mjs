import { readFileSync, realpathSync, mkdirSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import console from 'node:console';

export function hasUploadMount(root, mountInfo) {
  return mountInfo.split('\n').some((line) => {
    const encoded = line.split(' ')[4];
    if (!encoded) return false;
    const mount = encoded.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
    return mount !== '/' && (root === mount || root.startsWith(`${mount}/`));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const configured = process.env.UPLOAD_DIR;
  if (!configured || !isAbsolute(configured)) {
    throw new Error('UPLOAD_DIR must be an absolute path on persistent storage, e.g. /app/uploads');
  }
  mkdirSync(configured, { recursive: true });
  const root = realpathSync(configured);
  if (!hasUploadMount(root, readFileSync('/proc/self/mountinfo', 'utf8'))) {
    throw new Error(`UPLOAD_DIR ${root} is not mounted. Add --mount type=volume,source=ycomm-uploads,target=${root} to docker run (or configure a bind mount). Uploads in the container layer are lost on recreation.`);
  }
  console.log(`Upload storage mounted at ${root}`);
}
