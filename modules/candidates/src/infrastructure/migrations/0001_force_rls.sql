-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-005).
ALTER TABLE "candidates"."person" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "candidates"."person_identifier" FORCE ROW LEVEL SECURITY;
