CREATE TABLE "candidates"."outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"correlation_id" text,
	"dedupe_key" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "outbox_workspace_dedupe_key" UNIQUE("workspace_id","dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "candidates"."outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "outbox_unsent_idx" ON "candidates"."outbox" USING btree ("next_attempt_at") WHERE "candidates"."outbox"."sent_at" is null;--> statement-breakpoint
CREATE POLICY "outbox_tenant_isolation" ON "candidates"."outbox" AS PERMISSIVE FOR ALL TO public USING ("candidates"."outbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("candidates"."outbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "outbox_relay_read" ON "candidates"."outbox" AS PERMISSIVE FOR SELECT TO "aivera_relay" USING (true);--> statement-breakpoint
CREATE POLICY "outbox_relay_mark" ON "candidates"."outbox" AS PERMISSIVE FOR UPDATE TO "aivera_relay" USING (true) WITH CHECK (true);