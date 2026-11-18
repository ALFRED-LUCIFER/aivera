-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-005).
ALTER TABLE "workspaces"."workspace" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workspaces"."member" FORCE ROW LEVEL SECURITY;
