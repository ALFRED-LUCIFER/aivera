-- Custom migration (drizzle-kit generate --custom), the grants outboxTable documents (packages/db/src/outbox.ts):
-- FORCE row-level security (ADR-005); the app only writes and reads its own workspace's events; the relay reads every
-- workspace's events and may change only the delivery columns, with no grant on any other table (AIV-P0-014).
ALTER TABLE "candidates"."outbox" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "candidates"."outbox" FROM aivera_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "candidates" TO aivera_relay;
--> statement-breakpoint
GRANT SELECT, UPDATE (attempts, next_attempt_at, sent_at) ON "candidates"."outbox" TO aivera_relay;
