CREATE TABLE "intake"."inbox" (
	"consumer" text NOT NULL,
	"message_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"handled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inbox_consumer_message_id_pk" PRIMARY KEY("consumer","message_id")
);
--> statement-breakpoint
ALTER TABLE "intake"."inbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intake"."application" DROP CONSTRAINT "application_stage_check";--> statement-breakpoint
ALTER TABLE "intake"."application" ADD CONSTRAINT "application_stage_check" CHECK ("intake"."application"."stage" in ('new', 'first_pass_done', 'assessing', 'interview', 'in_process', 'in_pool', 'withdrawn', 'round2_shortlist', 'not_advanced'));--> statement-breakpoint
CREATE POLICY "inbox_tenant_isolation" ON "intake"."inbox" AS PERMISSIVE FOR ALL TO public USING ("intake"."inbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("intake"."inbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);