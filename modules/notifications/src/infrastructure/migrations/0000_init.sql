CREATE SCHEMA "notifications";
--> statement-breakpoint
CREATE TABLE "notifications"."inbox" (
	"consumer" text NOT NULL,
	"message_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"handled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inbox_consumer_message_id_pk" PRIMARY KEY("consumer","message_id")
);
--> statement-breakpoint
ALTER TABLE "notifications"."inbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications"."message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"template" text NOT NULL,
	"recipient_hash" text NOT NULL,
	"sealed" text NOT NULL,
	"status" text NOT NULL,
	"provider_message_id" text,
	"caused_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "message_status_check" CHECK ("notifications"."message"."status" in ('queued', 'sent', 'failed', 'bounced'))
);
--> statement-breakpoint
ALTER TABLE "notifications"."message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications"."outbox" (
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
ALTER TABLE "notifications"."outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "message_provider_message_id_key" ON "notifications"."message" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "outbox_unsent_idx" ON "notifications"."outbox" USING btree ("next_attempt_at") WHERE "notifications"."outbox"."sent_at" is null;--> statement-breakpoint
CREATE POLICY "inbox_tenant_isolation" ON "notifications"."inbox" AS PERMISSIVE FOR ALL TO public USING ("notifications"."inbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("notifications"."inbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "message_tenant_isolation" ON "notifications"."message" AS PERMISSIVE FOR ALL TO public USING ("notifications"."message"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("notifications"."message"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "message_delivery_report_read" ON "notifications"."message" AS PERMISSIVE FOR SELECT TO "aivera_app" USING (provider_message_id = nullif(current_setting('app.provider_message_id', true), ''));--> statement-breakpoint
CREATE POLICY "message_delivery_report_mark" ON "notifications"."message" AS PERMISSIVE FOR UPDATE TO "aivera_app" USING (provider_message_id = nullif(current_setting('app.provider_message_id', true), '')) WITH CHECK (provider_message_id = nullif(current_setting('app.provider_message_id', true), ''));--> statement-breakpoint
CREATE POLICY "outbox_tenant_isolation" ON "notifications"."outbox" AS PERMISSIVE FOR ALL TO public USING ("notifications"."outbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("notifications"."outbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "outbox_relay_read" ON "notifications"."outbox" AS PERMISSIVE FOR SELECT TO "aivera_relay" USING (true);--> statement-breakpoint
CREATE POLICY "outbox_relay_mark" ON "notifications"."outbox" AS PERMISSIVE FOR UPDATE TO "aivera_relay" USING (true) WITH CHECK (true);