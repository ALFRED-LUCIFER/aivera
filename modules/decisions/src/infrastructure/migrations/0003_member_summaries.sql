CREATE TABLE "decisions"."inbox" (
	"consumer" text NOT NULL,
	"message_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"handled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inbox_consumer_message_id_pk" PRIMARY KEY("consumer","message_id")
);
--> statement-breakpoint
ALTER TABLE "decisions"."inbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "decisions"."member_summary" (
	"workspace_id" uuid NOT NULL,
	"pack_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"status" text NOT NULL,
	"prompt_version" text,
	"summary" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "member_summary_pkey" PRIMARY KEY("workspace_id","pack_id","candidate_id"),
	CONSTRAINT "member_summary_status_check" CHECK ("decisions"."member_summary"."status" in ('ready', 'unavailable')),
	CONSTRAINT "member_summary_ready_check" CHECK (("decisions"."member_summary"."status" = 'ready') = ("decisions"."member_summary"."summary" is not null) and ("decisions"."member_summary"."status" = 'ready') = ("decisions"."member_summary"."prompt_version" is not null))
);
--> statement-breakpoint
ALTER TABLE "decisions"."member_summary" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "decisions"."member_summary" ADD CONSTRAINT "member_summary_member_fk" FOREIGN KEY ("workspace_id","pack_id","candidate_id") REFERENCES "decisions"."pack_member"("workspace_id","pack_id","candidate_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "inbox_tenant_isolation" ON "decisions"."inbox" AS PERMISSIVE FOR ALL TO public USING ("decisions"."inbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("decisions"."inbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "member_summary_tenant_isolation" ON "decisions"."member_summary" AS PERMISSIVE FOR ALL TO public USING ("decisions"."member_summary"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("decisions"."member_summary"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);