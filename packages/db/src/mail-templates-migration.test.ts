import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { createInMemoryDb } from './client';
import { mailBodyTemplates } from './schema/mail';

it('upgrades legacy body templates without losing saved content', async () => {
  const handle = await createInMemoryDb({ migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  try {
    // Only the legacy template table is needed to exercise migration 0018.
    await handle.db.execute(sql.raw('CREATE TABLE mail_body_templates (id uuid PRIMARY KEY, name text NOT NULL, body_html text NOT NULL, created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz)'));
    await handle.db.execute(sql`INSERT INTO mail_body_templates (id, name, body_html) VALUES ('00000000-0000-4000-8000-000000000018', '旧活动模板', '<p>原有正文</p>')`);
    const migration = await readFile(fileURLToPath(new URL('../migrations/0018_curious_beast.sql', import.meta.url)), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim()) await handle.db.execute(sql.raw(statement));
    }
    const [template] = await handle.db.select().from(mailBodyTemplates);
    expect(template).toMatchObject({ name: '旧活动模板', subject: '旧活动模板', subtitle: '', background: 'community', body_html: '<p>原有正文</p>' });
  } finally { await handle.close(); }
});
