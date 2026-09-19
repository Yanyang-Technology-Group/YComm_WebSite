import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createInMemoryDb, schema, type DatabaseHandle } from '@ycomm/db';
import { hashPassword } from '@ycomm/identity';
import { createSession } from './index';

let handle: DatabaseHandle;

beforeAll(async () => {
  const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations');
  handle = await createInMemoryDb({ migrationsFolder });
  await handle.runMigrations();
});

afterEach(async () => {
  for (const table of [schema.sessions, schema.users]) {
    await handle.db.delete(table);
  }
});

async function seedUser(username: string): Promise<string> {
  const [row] = await handle.db
    .insert(schema.users)
    .values({
      username,
      email: `${username}@example.com`,
      password_hash: await hashPassword('password-1'),
      role: 'member',
      state: 'active',
      display_name: username,
    })
    .returning({ id: schema.users.id });
  if (!row) throw new Error('no user');
  return row.id;
}

describe('sessions', () => {
  it('登录（创建会话）会写入最后登录时间 —— 管理后台不再显示「未记录」', async () => {
    const userId = await seedUser('login-time');

    const before = await handle.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    expect(before[0]?.last_seen_at).toBeNull();

    await createSession(handle.db, { userId, ip: '127.0.0.1', userAgent: 'vitest' });

    const after = await handle.db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    expect(after[0]?.last_seen_at).toBeInstanceOf(Date);
  });
});