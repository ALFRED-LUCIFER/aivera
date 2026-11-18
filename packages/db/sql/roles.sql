-- Database roles for local development and integration tests (ADR-004). In Azure the infrastructure creates them
-- with passwords from Key Vault; the password below is local-only and works nowhere else.
-- aivera_migrator owns the module schemas and runs migrations. aivera_app has data access only, is not the owner,
-- and is therefore always subject to row-level security.
CREATE ROLE aivera_migrator LOGIN PASSWORD 'local_dev_only';
CREATE ROLE aivera_app LOGIN PASSWORD 'local_dev_only';

DO $$ BEGIN
  EXECUTE format('GRANT CREATE, CONNECT ON DATABASE %I TO aivera_migrator', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO aivera_app', current_database());
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE aivera_migrator GRANT USAGE ON SCHEMAS TO aivera_app;
ALTER DEFAULT PRIVILEGES FOR ROLE aivera_migrator GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aivera_app;
ALTER DEFAULT PRIVILEGES FOR ROLE aivera_migrator GRANT USAGE, SELECT ON SEQUENCES TO aivera_app;
