CREATE TABLE "jobs"."catalogue_eval_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"keys" jsonb NOT NULL,
	"status" text NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"tokens" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	CONSTRAINT "catalogue_eval_run_status_check" CHECK ("jobs"."catalogue_eval_run"."status" in ('running', 'passed', 'failed', 'error')),
	CONSTRAINT "catalogue_eval_run_hash_check" CHECK ("jobs"."catalogue_eval_run"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "catalogue_eval_run_actor_check" CHECK (("jobs"."catalogue_eval_run"."requested_by" = 'system:seed' or "jobs"."catalogue_eval_run"."requested_by" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')),
	CONSTRAINT "catalogue_eval_run_tokens_check" CHECK ("jobs"."catalogue_eval_run"."tokens" >= 0),
	CONSTRAINT "catalogue_eval_run_finished_check" CHECK (("jobs"."catalogue_eval_run"."status" = 'running') = ("jobs"."catalogue_eval_run"."finished_at" is null) and ("jobs"."catalogue_eval_run"."status" in ('passed', 'failed')) = ("jobs"."catalogue_eval_run"."result" is not null))
);
--> statement-breakpoint
CREATE TABLE "jobs"."inbox" (
	"consumer" text NOT NULL,
	"message_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"handled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inbox_consumer_message_id_pk" PRIMARY KEY("consumer","message_id")
);
--> statement-breakpoint
ALTER TABLE "jobs"."inbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_eval_run" ADD CONSTRAINT "catalogue_eval_run_version_catalogue_version_version_fk" FOREIGN KEY ("version") REFERENCES "jobs"."catalogue_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalogue_eval_run_one_running_idx" ON "jobs"."catalogue_eval_run" USING btree ("version") WHERE "jobs"."catalogue_eval_run"."status" = 'running';--> statement-breakpoint
CREATE INDEX "catalogue_eval_run_latest_idx" ON "jobs"."catalogue_eval_run" USING btree ("version","requested_at");--> statement-breakpoint
CREATE POLICY "inbox_tenant_isolation" ON "jobs"."inbox" AS PERMISSIVE FOR ALL TO public USING ("jobs"."inbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("jobs"."inbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);