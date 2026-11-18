-- Database roles for local development and integration tests (ADR-004). In Azure the infrastructure creates them
-- mapped to managed identities (infra/sql/bootstrap-roles.sql); the password below is local-only and works nowhere else.
-- aivera_migrator owns the module schemas and runs migrations. aivera_app has data access only, is not the owner,
-- and is therefore always subject to row-level security.
CREATE ROLE aivera_migrator LOGIN PASSWORD 'local_dev_only';
CREATE ROLE aivera_app LOGIN PASSWORD 'local_dev_only';

DO $$ BEGIN
  EXECUTE format('GRANT CREATE, CONNECT ON DATABASE %I TO aivera_migrator', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO aivera_app', current_database());
END $$;

-- Default privileges for aivera_app are set by the migrator itself on every migrate (packages/db/src/migrate.ts).
