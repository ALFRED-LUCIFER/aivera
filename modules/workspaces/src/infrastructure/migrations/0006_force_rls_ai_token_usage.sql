-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-005).
ALTER TABLE "workspaces"."ai_token_usage" FORCE ROW LEVEL SECURITY;
