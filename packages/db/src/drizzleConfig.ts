import type { Config } from 'drizzle-kit';

/**
 * The Drizzle Kit config every module uses (ADR-004): its own schema only, migrations in
 * src/infrastructure/migrations, tracked in migrations.<schema>. A module's drizzle.config.ts is one line:
 * `export default moduleDrizzleConfig('jobs');`
 * Paths are relative to the module folder; `pnpm db:generate` runs Drizzle Kit from there (it loads the config as
 * CommonJS, so import.meta is not available).
 */
export function moduleDrizzleConfig(schema: string): Config {
  return {
    dialect: 'postgresql',
    schema: './src/infrastructure/schema.ts',
    out: './src/infrastructure/migrations',
    schemaFilter: [schema],
    // Tracking lives outside the module's schema: Drizzle Kit's first migration runs CREATE SCHEMA <schema>.
    migrations: { schema: 'migrations', table: schema },
    strict: true,
    verbose: true,
    ...(process.env['DATABASE_MIGRATOR_URL'] ? { dbCredentials: { url: process.env['DATABASE_MIGRATOR_URL'] } } : {}),
  };
}
