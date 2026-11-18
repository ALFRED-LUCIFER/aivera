// pnpm db:generate | pnpm db:migrate (ADR-004). Reads DATABASE_MIGRATOR_URL from the environment or .env.local.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { migrateModules } from './migrate.ts';
import { MODULES } from './modules.ts';

const command = process.argv[2];

if (command === 'generate') {
  if (MODULES.length === 0) console.log('No modules with migrations yet.');
  for (const module of MODULES) {
    console.log(`Generating migrations for ${module.name}`);
    execFileSync(join(import.meta.dirname, '..', 'node_modules', '.bin', 'drizzle-kit'), ['generate'], {
      cwd: module.dir,
      stdio: 'inherit',
    });
  }
} else if (command === 'migrate') {
  const url = process.env['DATABASE_MIGRATOR_URL'];
  if (!url) {
    console.error('Set DATABASE_MIGRATOR_URL (see docs/runbooks/local-development.md).');
    process.exit(1);
  }
  await migrateModules(url, MODULES);
  console.log(`Migrated ${MODULES.length} module(s).`);
} else {
  console.error('Usage: node src/cli.ts generate|migrate');
  process.exit(1);
}
