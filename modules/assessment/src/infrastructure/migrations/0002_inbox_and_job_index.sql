CREATE TABLE "assessment"."inbox" (
	"consumer" text NOT NULL,
	"message_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"handled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inbox_consumer_message_id_pk" PRIMARY KEY("consumer","message_id")
);
--> statement-breakpoint
ALTER TABLE "assessment"."inbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "result_job_idx" ON "assessment"."result" USING btree ("workspace_id","job_id","assessed_at");--> statement-breakpoint
CREATE POLICY "inbox_tenant_isolation" ON "assessment"."inbox" AS PERMISSIVE FOR ALL TO public USING ("assessment"."inbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("assessment"."inbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);