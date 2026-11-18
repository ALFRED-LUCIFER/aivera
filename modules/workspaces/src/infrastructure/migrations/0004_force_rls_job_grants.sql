-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-005).
ALTER TABLE "workspaces"."client" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workspaces"."job_grant" FORCE ROW LEVEL SECURITY;
