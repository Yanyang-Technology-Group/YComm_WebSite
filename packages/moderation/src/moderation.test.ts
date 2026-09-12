import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import { decide, enqueueForReview, listQueued, registerDecider } from './index';

let handle: DatabaseHandle;

beforeAll(async () => {
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations');
  handle = await createInMemoryDb({ migrationsFolder });
  await handle.runMigrations();
});

afterEach(async () => {
  for (const table of [schema.moderationItems, schema.posts, schema.topics]) {
    await handle.db.delete(table);
  }
});

describe('unified moderation queue', () => {
  it('decides an item through the domain decider and records the decision', async () => {
    // Register a fake decider standing in for a domain (forum/downloads).
    const targetId = randomUUID();
    const moderatorId = randomUUID();
    const acted: string[] = [];
    registerDecider('fake_target', {
      approve: async ({ targetId }) => {
        acted.push(`approve:${targetId}`);
      },
      reject: async ({ targetId }) => {
        acted.push(`reject:${targetId}`);
      },
    });

    await enqueueForReview(handle.db, { targetType: 'fake_target', targetId, reason: 'manual' });

    const pending = await listQueued(handle.db, {});
    expect(pending).toHaveLength(1);
    const item = pending[0];
    if (!item) throw new Error('expected item');

    await decide(handle.db, item.id, { decision: 'approve', by: moderatorId, note: 'ok' });
    expect(acted).toEqual([`approve:${targetId}`]);

    const [after] = await handle.db.select().from(schema.moderationItems).where(eq(schema.moderationItems.id, item.id));
    expect(after?.status).toBe('approved');
    expect(after?.decided_by).toBe(moderatorId);

    // Already decided — second decide is a 404-style unknown item.
    await expect(decide(handle.db, item.id, { decision: 'reject', by: moderatorId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects are recorded symmetrically', async () => {
    registerDecider('fake_target', {
      approve: async () => undefined,
      reject: async () => undefined,
    });
    await enqueueForReview(handle.db, { targetType: 'fake_target', targetId: randomUUID(), reason: 'new_user_review' });
    const pending = await listQueued(handle.db, {});
    const item = pending[0];
    if (!item) throw new Error('expected item');
    await decide(handle.db, item.id, { decision: 'reject', by: randomUUID() });
    const [after] = await handle.db.select().from(schema.moderationItems).where(eq(schema.moderationItems.id, item.id));
    expect(after?.status).toBe('rejected');
  });

  it('fails loudly when no decider is registered', async () => {
    await enqueueForReview(handle.db, { targetType: 'no_decider', targetId: randomUUID(), reason: 'manual' });
    const pending = await listQueued(handle.db, {});
    const item = pending[0];
    if (!item) throw new Error('expected item');
    await expect(decide(handle.db, item.id, { decision: 'approve', by: 'owner' })).rejects.toMatchObject({
      code: 'INTERNAL',
    });
  });
});