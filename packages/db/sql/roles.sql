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

-- aivera_public reads the candidate site's published jobs (AIV-P3-002). It cannot sign in: aivera_app switches to it
-- with SET LOCAL ROLE for public reads, so a wrong query there reaches only what aivera_public is granted (jobs
-- grants.sql). INHERIT FALSE: aivera_app never gains aivera_public's grants without switching to it.
CREATE ROLE aivera_public NOLOGIN;
GRANT aivera_public TO aivera_app WITH INHERIT FALSE, SET TRUE;

-- Default privileges for aivera_app are set by the migrator itself on every migrate (packages/db/src/migrate.ts).
