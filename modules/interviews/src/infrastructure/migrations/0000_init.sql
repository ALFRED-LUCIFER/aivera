CREATE SCHEMA "interviews";
--> statement-breakpoint
CREATE TABLE "interviews"."interview" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"round" text NOT NULL,
	"interviewer_user_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone,
	"status" text NOT NULL,
	"rubric_version_id" uuid NOT NULL,
	"competency_ids" uuid[] NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "interview_workspace_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "interview_round_check" CHECK ("interviews"."interview"."round" in ('structured_screen', 'evidence_defence', 'panel')),
	CONSTRAINT "interview_status_check" CHECK ("interviews"."interview"."status" in ('to_schedule', 'scheduled', 'in_progress', 'scorecard_due', 'completed', 'cancelled')),
	CONSTRAINT "interview_scheduled_at_check" CHECK (("interviews"."interview"."status" <> 'scheduled' or "interviews"."interview"."scheduled_at" is not null) and ("interviews"."interview"."status" <> 'to_schedule' or "interviews"."interview"."scheduled_at" is null))
);
--> statement-breakpoint
ALTER TABLE "interviews"."interview" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interviews"."outbox" (
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
ALTER TABLE "interviews"."outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "interview_status_idx" ON "interviews"."interview" USING btree ("workspace_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "outbox_unsent_idx" ON "interviews"."outbox" USING btree ("next_attempt_at") WHERE "interviews"."outbox"."sent_at" is null;--> statement-breakpoint
CREATE POLICY "interview_tenant_isolation" ON "interviews"."interview" AS PERMISSIVE FOR ALL TO public USING ("interviews"."interview"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("interviews"."interview"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "outbox_tenant_isolation" ON "interviews"."outbox" AS PERMISSIVE FOR ALL TO public USING ("interviews"."outbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("interviews"."outbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "outbox_relay_read" ON "interviews"."outbox" AS PERMISSIVE FOR SELECT TO "aivera_relay" USING (true);--> statement-breakpoint
CREATE POLICY "outbox_relay_mark" ON "interviews"."outbox" AS PERMISSIVE FOR UPDATE TO "aivera_relay" USING (true) WITH CHECK (true);