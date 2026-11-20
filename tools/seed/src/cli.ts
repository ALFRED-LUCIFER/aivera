// pnpm db:seed [--reset]. Connects as DATABASE_URL (the app role, under row-level security) from the environment or
// .env.local; refused unless APP_ENV is local or dev.
import { createDb } from '@credalent/db/client';
import { SeedRefused, seedDemo } from './seed.ts';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('Set DATABASE_URL (see docs/runbooks/local-development.md).');
  process.exit(1);
}
const db = createDb(url, { max: 1 });
try {
  const id = await seedDemo(db, { appEnv: process.env['APP_ENV'], reset: process.argv.includes('--reset') });
  console.log(`Seeded the synthetic demo workspace ${id}.`);
} catch (error) {
  // The message and name only: a database error's detail can echo row values (AGENTS.md 1.2).
  console.error(
    error instanceof SeedRefused
      ? error.message
      : error instanceof Error
        ? `Seed failed: ${error.name}: ${error.message}`
        : 'Seed failed',
  );
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
