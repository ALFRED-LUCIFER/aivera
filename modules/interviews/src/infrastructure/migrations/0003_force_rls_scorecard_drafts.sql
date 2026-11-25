-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-005).
ALTER TABLE "interviews"."scorecard_drafts" FORCE ROW LEVEL SECURITY;
