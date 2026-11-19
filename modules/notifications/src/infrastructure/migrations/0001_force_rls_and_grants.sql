-- Custom migration (drizzle-kit generate --custom): FORCE row-level security on every table (ADR-005), and the
-- outbox grants outboxTable documents (packages/db/src/outbox.ts): the app cannot suppress an event, and the relay
-- reads and marks outbox rows only (AIV-P0-014).
ALTER TABLE "notifications"."message" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notifications"."inbox" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notifications"."outbox" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "notifications"."outbox" FROM aivera_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "notifications" TO aivera_relay;
--> statement-breakpoint
GRANT SELECT, UPDATE (attempts, next_attempt_at, sent_at) ON "notifications"."outbox" TO aivera_relay;
