-- Idempotent grants re-applied after every migrate (packages/db/src/migrate.ts), run as the migrator, which owns the
-- tables. The candidate site reads published jobs as aivera_public (AIV-P3-002): the public columns of
-- jobs.public_job and nothing else, never workspace_id or job_id. The role is created outside migrations (local
-- packages/db/sql/roles.sql, Azure infra/sql/bootstrap-roles.sql), so until it exists this grants nothing.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'aivera_public') THEN
    GRANT USAGE ON SCHEMA jobs TO aivera_public;
    GRANT SELECT (slug, title, job_type, descriptor, location, pay_min_minor, pay_max_minor, pay_currency,
      competencies, posted_at, open) ON jobs.public_job TO aivera_public;
  END IF;
END $$;
