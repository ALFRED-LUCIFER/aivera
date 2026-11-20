-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-005).
ALTER TABLE "evidence"."repository_skill_signal" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evidence"."repository_skill_grade" FORCE ROW LEVEL SECURITY;
