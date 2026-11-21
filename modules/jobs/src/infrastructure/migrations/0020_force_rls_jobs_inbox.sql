-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-005).
ALTER TABLE "jobs"."inbox" FORCE ROW LEVEL SECURITY;
