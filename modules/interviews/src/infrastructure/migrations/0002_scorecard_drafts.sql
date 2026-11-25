CREATE TABLE "interviews"."scorecard_drafts" (
	"interview_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"competencies" jsonb NOT NULL,
	"recommendation" text,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "scorecard_drafts_recommendation_check" CHECK ("interviews"."scorecard_drafts"."recommendation" in ('shortlist', 'more_evidence', 'not_recommended'))
);
--> statement-breakpoint
ALTER TABLE "interviews"."scorecard_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "interviews"."scorecard_drafts" ADD CONSTRAINT "scorecard_drafts_interview_fk" FOREIGN KEY ("workspace_id","interview_id") REFERENCES "interviews"."interview"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "scorecard_drafts_tenant_isolation" ON "interviews"."scorecard_drafts" AS PERMISSIVE FOR ALL TO public USING ("interviews"."scorecard_drafts"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("interviews"."scorecard_drafts"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);