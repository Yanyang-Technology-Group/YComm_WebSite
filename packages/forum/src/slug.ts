import { randomBytes } from 'node:crypto';

/**
 * Short, unique-ish slug used in topic URLs.
 *
 * Topics are addressed by UUID in routes, and titles are often Chinese (no
 * ASCII transliteration), so the slug is a compact random token that keeps the
 * `unique(board_id, slug)` constraint meaningful without trying to transliterate.
 */
export function newTopicSlug(): string {
  return randomBytes(6).toString('hex');
}