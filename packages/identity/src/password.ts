import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id — memory-hard, the current recommendation for password storage.
 * `@node-rs/argon2` ships prebuilt binaries, no build step at install time.
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

/** Constant-time-safe verify; any failure (bad hash, malformed input) is false. */
export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}