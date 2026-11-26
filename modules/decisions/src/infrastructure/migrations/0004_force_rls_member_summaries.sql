-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-005).
ALTER TABLE "decisions"."member_summary" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "decisions"."inbox" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A member's summary is written once for the snapshot it summarises (AIV-P2-011): the app may not rewrite or drop it.
REVOKE UPDATE, DELETE, TRUNCATE ON "decisions"."member_summary" FROM aivera_app;
