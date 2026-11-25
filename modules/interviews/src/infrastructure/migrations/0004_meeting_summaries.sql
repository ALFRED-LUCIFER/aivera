CREATE TABLE "interviews"."inbox" (
	"consumer" text NOT NULL,
	"message_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"handled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inbox_consumer_message_id_pk" PRIMARY KEY("consumer","message_id")
);
--> statement-breakpoint
ALTER TABLE "interviews"."inbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interviews"."meeting_summaries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"interview_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"status" text NOT NULL,
	"unusual" boolean NOT NULL,
	"prompt_version" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "meeting_summaries_workspace_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "meeting_summaries_status_check" CHECK ("interviews"."meeting_summaries"."status" in ('analysing', 'waiting', 'failed', 'proposed', 'applied', 'declined')),
	CONSTRAINT "meeting_summaries_text_check" CHECK (char_length("interviews"."meeting_summaries"."text") between 1 and 12000)
);
--> statement-breakpoint
ALTER TABLE "interviews"."meeting_summaries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "interviews"."summary_proposals" (
	"summary_id" uuid NOT NULL,
	"competency_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"finding" text NOT NULL,
	"excerpt" text,
	"excerpt_start" integer,
	"excerpt_end" integer,
	"reason" text,
	"proposed_strength" text,
	"status" text NOT NULL,
	CONSTRAINT "summary_proposals_summary_id_competency_id_pk" PRIMARY KEY("summary_id","competency_id"),
	CONSTRAINT "summary_proposals_finding_check" CHECK ("interviews"."summary_proposals"."finding" in ('not_mentioned', 'not_shown', 'partly_shown', 'clearly_shown', 'strongly_shown')),
	CONSTRAINT "summary_proposals_status_check" CHECK ("interviews"."summary_proposals"."status" in ('proposed', 'applied', 'declined')),
	CONSTRAINT "summary_proposals_strength_check" CHECK ("interviews"."summary_proposals"."proposed_strength" in ('claim', 'medium')),
	CONSTRAINT "summary_proposals_excerpt_check" CHECK (("interviews"."summary_proposals"."finding" = 'not_mentioned') = ("interviews"."summary_proposals"."excerpt" is null))
);
--> statement-breakpoint
ALTER TABLE "interviews"."summary_proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "interviews"."meeting_summaries" ADD CONSTRAINT "meeting_summaries_interview_fk" FOREIGN KEY ("workspace_id","interview_id") REFERENCES "interviews"."interview"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews"."summary_proposals" ADD CONSTRAINT "summary_proposals_summary_fk" FOREIGN KEY ("workspace_id","summary_id") REFERENCES "interviews"."meeting_summaries"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_summaries_interview_idx" ON "interviews"."meeting_summaries" USING btree ("workspace_id","interview_id","created_at");--> statement-breakpoint
CREATE POLICY "inbox_tenant_isolation" ON "interviews"."inbox" AS PERMISSIVE FOR ALL TO public USING ("interviews"."inbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("interviews"."inbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "meeting_summaries_tenant_isolation" ON "interviews"."meeting_summaries" AS PERMISSIVE FOR ALL TO public USING ("interviews"."meeting_summaries"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("interviews"."meeting_summaries"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "summary_proposals_tenant_isolation" ON "interviews"."summary_proposals" AS PERMISSIVE FOR ALL TO public USING ("interviews"."summary_proposals"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("interviews"."summary_proposals"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);