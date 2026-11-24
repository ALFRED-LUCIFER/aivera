-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-005),
-- plus the outbox grants outboxTable documents (packages/db/src/outbox.ts): the app only writes and reads its own
-- workspace's events; the relay reads every workspace's events and may change only the delivery columns (AIV-P0-014).
ALTER TABLE "interviews"."interview" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "interviews"."outbox" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "interviews"."outbox" FROM aivera_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "interviews" TO aivera_relay;
--> statement-breakpoint
GRANT SELECT, UPDATE (attempts, next_attempt_at, sent_at) ON "interviews"."outbox" TO aivera_relay;
