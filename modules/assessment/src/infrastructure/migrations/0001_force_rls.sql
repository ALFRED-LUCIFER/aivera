-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-005).
-- A stored result is history: the app may add and delete rows (a candidate's erasure, AGENTS.md 1.9), never rewrite one.
-- The delete paths (seed reset, erasure) arrive with the first writer of real rows (AIV-P1-031) and erasure (AIV-P3-014).
ALTER TABLE "assessment"."result" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE UPDATE, TRUNCATE ON "assessment"."result" FROM aivera_app;
