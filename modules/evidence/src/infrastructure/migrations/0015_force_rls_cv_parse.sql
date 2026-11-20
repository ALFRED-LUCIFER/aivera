-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-005).
ALTER TABLE "evidence"."cv_parse" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evidence"."source_note" FORCE ROW LEVEL SECURITY;
