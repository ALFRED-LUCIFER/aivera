-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-005).
ALTER TABLE "evidence"."request" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evidence"."request_item" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evidence"."portal_token" FORCE ROW LEVEL SECURITY;
