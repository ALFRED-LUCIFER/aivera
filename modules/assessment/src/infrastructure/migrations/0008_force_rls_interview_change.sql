-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-005).
-- An applied interview change is history: the app may add rows and delete them with their result (erasure), never rewrite one.
ALTER TABLE "assessment"."interview_change" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE UPDATE, TRUNCATE ON "assessment"."interview_change" FROM aivera_app;
