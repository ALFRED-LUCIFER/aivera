-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-005).
ALTER TABLE "intake"."sheet_imports" FORCE ROW LEVEL SECURITY;
