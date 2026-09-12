import { createDb } from '../client';
import { seedDefaults } from '../seed';

/** `npm run db:seed` — idempotent bootstrap data (boards, categories, settings). */
const handle = await createDb();
try {
  await seedDefaults(handle.db);
  console.log('Seed OK');
} finally {
  await handle.close();
}