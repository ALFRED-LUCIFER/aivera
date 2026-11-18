import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.ts';
import { migrationsFolder, type MigratableModule } from './modules.ts';

/**
 * Applies each module's committed Drizzle Kit migrations, in order, each tracked in its own table
 * `migrations.<module>` (ADR-004). Already-applied migrations are skipped, so a rerun applies nothing.
 */
export async function migrateModules(migratorUrl: string, modules: MigratableModule[]): Promise<void> {
  const db = createDb(migratorUrl, { max: 1 });
  try {
    // The app role may use what the migrator creates. Run as the migrator itself: Azure has no superuser (ADR-008).
    await db.execute(sql`ALTER DEFAULT PRIVILEGES GRANT USAGE ON SCHEMAS TO aivera_app`);
    await db.execute(sql`ALTER DEFAULT PRIVILEGES GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aivera_app`);
    await db.execute(sql`ALTER DEFAULT PRIVILEGES GRANT USAGE, SELECT ON SEQUENCES TO aivera_app`);
    for (const module of modules) {
      await migrate(db, {
        migrationsFolder: migrationsFolder(module),
        migrationsSchema: 'migrations',
        migrationsTable: module.name,
      });
    }
  } finally {
    await db.$client.end();
  }
}
