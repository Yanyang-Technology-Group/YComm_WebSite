import { getSetting, type Db } from '@ycomm/db';
import { errors } from '@ycomm/kernel';

export const BANNED_WORDS_SETTING = 'bannedWords';

/**
 * Admin-configurable forbidden words (settings key `bannedWords`, a string
 * array). Contents are matched case-insensitively as substrings; posts
 * containing any banned word are rejected before they reach the database.
 */
export async function loadBannedWords(db: Db): Promise<string[]> {
  const raw = await getSetting(db, BANNED_WORDS_SETTING);
  if (!Array.isArray(raw)) return [];
  const words: string[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      words.push(entry.trim().toLowerCase());
    }
  }
  return words;
}

/** Throws VALIDATION_FAILED with the offending word when content is blocked. */
export function assertNoBannedWords(content: string, banned: readonly string[]): void {
  if (banned.length === 0) return;
  const lower = content.toLowerCase();
  const hit = banned.find((word) => word.length > 0 && lower.includes(word));
  if (hit) {
    throw errors.validation({
      issues: [{ path: 'content', message: `内容包含违禁词「${hit}」，已拦截` }],
    });
  }
}