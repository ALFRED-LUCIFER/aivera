-- Custom migration (drizzle-kit generate --custom): FORCE row-level security (ADR-005) and append-only audit entries.
ALTER TABLE "audit"."entry" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- roles.sql grants aivera_app UPDATE and DELETE on every new table by default privilege; audit rows are insert-only.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit"."entry" FROM aivera_app;
--> statement-breakpoint
-- Second layer, for every role including the owner: any change to an audit row raises. A new audit table reuses
-- this function and repeats the REVOKE; tests/integration/src/audit.test.ts checks both for every table in "audit".
CREATE FUNCTION "audit"."refuse_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit entries are append-only' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
CREATE TRIGGER "entry_append_only" BEFORE UPDATE OR DELETE ON "audit"."entry"
  FOR EACH ROW EXECUTE FUNCTION "audit"."refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "entry_no_truncate" BEFORE TRUNCATE ON "audit"."entry"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit"."refuse_change"();
