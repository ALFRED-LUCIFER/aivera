-- Custom migration (drizzle-kit generate --custom), AIV-P2-035: the platform audit log is insert-only for the app
-- (ADR-012). roles.sql's default privileges grant aivera_app SELECT, UPDATE and DELETE on every new table; revoke them,
-- so the app can neither read operator activity nor change it.
REVOKE SELECT, UPDATE, DELETE, TRUNCATE ON "audit"."platform_entry" FROM aivera_app;
--> statement-breakpoint
-- Second layer for every role, the owner included, as on audit.entry (0001_append_only, 0002_always_triggers).
CREATE TRIGGER "platform_entry_append_only" BEFORE UPDATE OR DELETE ON "audit"."platform_entry"
  FOR EACH ROW EXECUTE FUNCTION "audit"."refuse_change"();
--> statement-breakpoint
CREATE TRIGGER "platform_entry_no_truncate" BEFORE TRUNCATE ON "audit"."platform_entry"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit"."refuse_change"();
--> statement-breakpoint
ALTER TABLE "audit"."platform_entry" ENABLE ALWAYS TRIGGER "platform_entry_append_only";
--> statement-breakpoint
ALTER TABLE "audit"."platform_entry" ENABLE ALWAYS TRIGGER "platform_entry_no_truncate";
