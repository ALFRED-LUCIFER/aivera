-- One-off, owner only (AIV-P0-004, ADR-008): Credalent's database roles on the shared Medvya dev server.
-- infra/scripts/bootstrap-db.sh runs it as a server Entra admin, connected to the "postgres" database, from inside
-- the VNet, with psql variables app_oid, cicd_oid and relay_oid. The Azure counterpart of packages/db/sql/roles.sql: the roles
-- map to managed identities (password sign-in is off on this server), so no password exists. Safe to rerun.
-- aivera_migrator (id-aivera-cicd-dev) owns Credalent's schemas and runs migrations.
-- aivera_app (id-aivera-dev) has data access only, is never an owner, and is always subject to row-level security.
-- aivera_relay (id-aivera-relay-dev, AIV-P0-014) reads and marks outbox rows only, through their relay policies.
SELECT pgaadauth_create_principal_with_oid('aivera_migrator', :'cicd_oid', 'service', false, false)
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aivera_migrator');
SELECT pgaadauth_create_principal_with_oid('aivera_app', :'app_oid', 'service', false, false)
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aivera_app');
SELECT pgaadauth_create_principal_with_oid('aivera_relay', :'relay_oid', 'service', false, false)
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aivera_relay');

-- aivera_public (AIV-P3-002): reads the candidate site's published jobs, entered by aivera_app with SET LOCAL ROLE.
-- No login and no identity. The migrator grants its columns on every migrate (modules/jobs grants.sql).
SELECT 'CREATE ROLE aivera_public NOLOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aivera_public')
\gexec
-- Guarded, so a rerun by another Entra admin (without ADMIN on aivera_public) does not stop the script here.
-- A membership made before INHERIT FALSE was set would keep inheriting: then REVOKE aivera_public FROM aivera_app once
-- and rerun.
SELECT 'GRANT aivera_public TO aivera_app WITH INHERIT FALSE, SET TRUE'
WHERE NOT pg_has_role('aivera_app', 'aivera_public', 'MEMBER')
\gexec

-- Isolation from Medvya: only Credalent's roles may connect to the aivera database.
REVOKE ALL ON DATABASE aivera FROM PUBLIC;
GRANT CREATE, CONNECT, TEMPORARY ON DATABASE aivera TO aivera_migrator;
GRANT CONNECT ON DATABASE aivera TO aivera_app;
GRANT CONNECT ON DATABASE aivera TO aivera_relay;

-- Evidence for the PR and ADR-008: no superuser, no BYPASSRLS, no CREATEROLE, and which databases each role can
-- connect to. A Medvya database listed here means it still grants CONNECT to PUBLIC: agree with Medvya to revoke it.
SELECT r.rolname, r.rolsuper, r.rolbypassrls, r.rolcreaterole,
       array_agg(d.datname ORDER BY d.datname) FILTER (WHERE has_database_privilege(r.rolname, d.datname, 'CONNECT'))
         AS can_connect_to
FROM pg_roles r CROSS JOIN pg_database d
WHERE r.rolname IN ('aivera_migrator', 'aivera_app', 'aivera_relay', 'aivera_public') AND NOT d.datistemplate
GROUP BY r.rolname, r.rolsuper, r.rolbypassrls, r.rolcreaterole;
