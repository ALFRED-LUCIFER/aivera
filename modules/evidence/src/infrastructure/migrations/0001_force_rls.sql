-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-005),
-- and the outbox grants outboxTable documents (packages/db/src/outbox.ts): the app only writes and reads its own
-- workspace's events; the relay reads every workspace's events and may change only the delivery columns (AIV-P0-014).
ALTER TABLE "evidence"."source" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evidence"."item" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evidence"."competency_link" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evidence"."outbox" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "evidence"."outbox" FROM aivera_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "evidence" TO aivera_relay;
--> statement-breakpoint
GRANT SELECT, UPDATE (attempts, next_attempt_at, sent_at) ON "evidence"."outbox" TO aivera_relay;
