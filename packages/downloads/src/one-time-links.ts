import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import { schema, type Db } from '@ycomm/db';
import { hashToken, newToken } from '@ycomm/kernel';

export async function createOneTimeLink(db: Db, cardId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken(32);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.delete(schema.downloadCardTickets).where(lte(schema.downloadCardTickets.expires_at, new Date()));
  await db.insert(schema.downloadCardTickets).values({ token_hash: hashToken(token), card_id: cardId, expires_at: expiresAt });
  return { token, expiresAt };
}

/** HEAD probes leave the ticket available; the first GET claims it before streaming. */
export async function redeemOneTimeLink(db: Db, token: string, consume = true): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const tickets = schema.downloadCardTickets;
  const usable = and(eq(tickets.token_hash, hashToken(token)), isNull(tickets.consumed_at), gt(tickets.expires_at, new Date()));
  const rows = consume
    ? await db.update(tickets).set({ consumed_at: new Date() }).where(usable).returning({ cardId: tickets.card_id })
    : await db.select({ cardId: tickets.card_id }).from(tickets).where(usable).limit(1);
  return rows[0]?.cardId ?? null;
}
