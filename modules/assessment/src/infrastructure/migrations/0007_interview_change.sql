CREATE TABLE "assessment"."interview_change" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"result_id" uuid NOT NULL,
	"competency_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"strength" text NOT NULL,
	"level" smallint NOT NULL,
	"item_ids" jsonb NOT NULL,
	"reason" text NOT NULL,
	"applied_by" uuid NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"preview_id" text NOT NULL,
	CONSTRAINT "interview_change_strength_check" CHECK ("assessment"."interview_change"."strength" in ('claim', 'medium', 'strong')),
	CONSTRAINT "interview_change_level_check" CHECK ("assessment"."interview_change"."level" between 0 and 5),
	CONSTRAINT "interview_change_reason_check" CHECK (length(trim("assessment"."interview_change"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "assessment"."interview_change" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assessment"."interview_change" ADD CONSTRAINT "interview_change_result_id_result_id_fk" FOREIGN KEY ("result_id") REFERENCES "assessment"."result"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interview_change_candidate_job_idx" ON "assessment"."interview_change" USING btree ("workspace_id","candidate_id","job_id","applied_at");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_change_idempotency_idx" ON "assessment"."interview_change" USING btree ("workspace_id","idempotency_key","competency_id");--> statement-breakpoint
CREATE POLICY "interview_change_tenant_isolation" ON "assessment"."interview_change" AS PERMISSIVE FOR ALL TO public USING ("assessment"."interview_change"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("assessment"."interview_change"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);