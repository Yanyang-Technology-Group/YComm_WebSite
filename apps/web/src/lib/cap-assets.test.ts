import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('self-hosted CAP WASM solver', () => {
  it('initializes the vendored browser module and solves a SHA-256 challenge', async () => {
    const assets = new URL('../../public/cap/0.0.6/', import.meta.url);
    const source = await readFile(new URL('cap_wasm.min.js', assets), 'utf8');
    const binary = await readFile(new URL('cap_wasm_bg.wasm', assets));
    const solver = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`) as {
      default: (options: { module_or_path: Buffer }) => Promise<unknown>;
      solve_pow: (salt: string, target: string) => bigint;
    };
    await solver.default({ module_or_path: binary });
    const salt = 'ycomm-self-hosted-cap-regression';
    const target = '00';
    const nonce = solver.solve_pow(salt, target);
    expect(nonce).toBeGreaterThanOrEqual(0n);
    expect(createHash('sha256').update(`${salt}${nonce}`).digest('hex').startsWith(target)).toBe(true);
  });
});
