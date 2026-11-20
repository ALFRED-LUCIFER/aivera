CREATE SCHEMA "intake";
--> statement-breakpoint
CREATE TABLE "intake"."application" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"submitted_to_client_at" timestamp with time zone,
	CONSTRAINT "application_workspace_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "application_person_job_key" UNIQUE("workspace_id","person_id","job_id"),
	CONSTRAINT "application_stage_check" CHECK ("intake"."application"."stage" in ('new', 'first_pass_done', 'assessing', 'in_process', 'in_pool', 'withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "intake"."application" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "intake"."application_source" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"source" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"file_ids" uuid[] NOT NULL,
	"links" text[] NOT NULL,
	CONSTRAINT "application_source_source_check" CHECK ("intake"."application_source"."source" in ('linkedin', 'careers_page', 'referral', 'email', 'whatsapp'))
);
--> statement-breakpoint
ALTER TABLE "intake"."application_source" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "intake"."outbox" (
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
ALTER TABLE "intake"."outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intake"."application_source" ADD CONSTRAINT "application_source_application_fk" FOREIGN KEY ("workspace_id","application_id") REFERENCES "intake"."application"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_job_idx" ON "intake"."application" USING btree ("workspace_id","job_id","received_at");--> statement-breakpoint
CREATE INDEX "application_source_application_idx" ON "intake"."application_source" USING btree ("workspace_id","application_id");--> statement-breakpoint
CREATE INDEX "outbox_unsent_idx" ON "intake"."outbox" USING btree ("next_attempt_at") WHERE "intake"."outbox"."sent_at" is null;--> statement-breakpoint
CREATE POLICY "application_tenant_isolation" ON "intake"."application" AS PERMISSIVE FOR ALL TO public USING ("intake"."application"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("intake"."application"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "application_source_tenant_isolation" ON "intake"."application_source" AS PERMISSIVE FOR ALL TO public USING ("intake"."application_source"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("intake"."application_source"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "outbox_tenant_isolation" ON "intake"."outbox" AS PERMISSIVE FOR ALL TO public USING ("intake"."outbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("intake"."outbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "outbox_relay_read" ON "intake"."outbox" AS PERMISSIVE FOR SELECT TO "aivera_relay" USING (true);--> statement-breakpoint
CREATE POLICY "outbox_relay_mark" ON "intake"."outbox" AS PERMISSIVE FOR UPDATE TO "aivera_relay" USING (true) WITH CHECK (true);