-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-005),
-- plus the outbox grants outboxTable documents (packages/db/src/outbox.ts): the app only writes and reads its own
-- workspace's events; the relay reads every workspace's events and may change only the delivery columns (AIV-P0-014).
ALTER TABLE "decisions"."pack" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "decisions"."pack_member" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "decisions"."decision" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "decisions"."outbox" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A pack stays on its job and rubric version: the app may change only its status (AIV-P2-009).
REVOKE UPDATE, TRUNCATE ON "decisions"."pack" FROM aivera_app;
--> statement-breakpoint
GRANT UPDATE (status) ON "decisions"."pack" TO aivera_app;
--> statement-breakpoint
-- A member's assessment snapshot is written once: no later score change can rewrite it, and no member can be dropped.
REVOKE UPDATE, DELETE, TRUNCATE ON "decisions"."pack_member" FROM aivera_app;
--> statement-breakpoint
-- A recorded decision is append-only, as its audit entry is.
REVOKE UPDATE, DELETE, TRUNCATE ON "decisions"."decision" FROM aivera_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "decisions"."outbox" FROM aivera_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "decisions" TO aivera_relay;
--> statement-breakpoint
GRANT SELECT, UPDATE (attempts, next_attempt_at, sent_at) ON "decisions"."outbox" TO aivera_relay;
