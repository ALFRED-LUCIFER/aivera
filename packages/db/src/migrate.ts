import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.ts';
import { migrationsFolder, type MigratableModule } from './modules.ts';

/**
 * Applies each module's committed Drizzle Kit migrations, in order, each tracked in its own table
 * `migrations.<module>` (ADR-004). Already-applied migrations are skipped, so a rerun applies nothing.
 */
export async function migrateModules(migratorUrl: string, modules: MigratableModule[]): Promise<void> {
  const db = createDb(migratorUrl, { max: 1, timeouts: false });
  try {
    // The app role may use what the migrator creates. Run as the migrator itself: Azure has no superuser (ADR-008).
    await db.execute(sql`ALTER DEFAULT PRIVILEGES GRANT USAGE ON SCHEMAS TO aivera_app`);
    await db.execute(sql`ALTER DEFAULT PRIVILEGES GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aivera_app`);
    await db.execute(sql`ALTER DEFAULT PRIVILEGES GRANT USAGE, SELECT ON SEQUENCES TO aivera_app`);
    for (const module of modules) {
      // Each module's pending migrations run in one transaction, so the module is what failed (deploy log, AIV-P0-006).
      await migrate(db, {
        migrationsFolder: migrationsFolder(module),
        migrationsSchema: 'migrations',
        migrationsTable: module.name,
      }).catch((error: unknown) => {
        throw new Error(`Migrations failed for module ${module.name}; nothing of it was applied.`, { cause: error });
      });
      // A module's grants to roles made outside migrations (the public role, AIV-P3-002), re-applied on every run so
      // a role created after the migration still gets them. The file is idempotent.
      const grants = join(module.dir, 'src', 'infrastructure', 'grants.sql');
      if (existsSync(grants))
        await db.execute(sql.raw(readFileSync(grants, 'utf8'))).catch((error: unknown) => {
          throw new Error(`Grants failed for module ${module.name}.`, { cause: error });
        });
    }
    // The default privileges above also reach the migrator's journal: the app must never edit what was applied.
    await db.execute(sql`REVOKE ALL ON ALL TABLES IN SCHEMA migrations FROM aivera_app`);
    await db.execute(sql`REVOKE ALL ON ALL SEQUENCES IN SCHEMA migrations FROM aivera_app`);
    await db.execute(sql`REVOKE ALL ON SCHEMA migrations FROM aivera_app`);
  } finally {
    await db.$client.end();
  }
}
