import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/** Primary key for domain entities. */
export function newId(): string {
  return randomUUID();
}

/**
 * Opaque secret handed to a client (session cookie, email token, signed URL).
 * 32 bytes of entropy, URL-safe so it can live in a cookie or query string.
 */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Hash for storing tokens at rest.
 *
 * Tokens are high-entropy random values, so a fast digest is the right tool:
 * they cannot be brute-forced the way a human password can, and verification
 * happens on every request.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison for secrets that are compared directly. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
