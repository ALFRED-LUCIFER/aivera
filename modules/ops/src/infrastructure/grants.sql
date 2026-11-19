-- Idempotent grants re-applied after every migrate (packages/db/src/migrate.ts), run as the migrator. The settings
-- table has exactly one row, inserted by migration 0001: the app reads and updates it, never adds or removes one.
REVOKE INSERT, DELETE, TRUNCATE ON ops.platform_setting FROM aivera_app;
