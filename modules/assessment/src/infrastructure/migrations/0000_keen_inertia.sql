CREATE SCHEMA "assessment";
--> statement-breakpoint
CREATE TABLE "assessment"."result" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"rubric_version_id" uuid NOT NULL,
	"backed_score" smallint NOT NULL,
	"upper_bound" smallint NOT NULL,
	"meets_need" smallint NOT NULL,
	"competency_count" smallint NOT NULL,
	"missing_critical" jsonb NOT NULL,
	"confidence" text NOT NULL,
	"competencies" jsonb NOT NULL,
	"assessed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "result_scores_check" CHECK ("assessment"."result"."backed_score" between 0 and 100 and "assessment"."result"."upper_bound" between "assessment"."result"."backed_score" and 100),
	CONSTRAINT "result_meets_need_check" CHECK ("assessment"."result"."meets_need" between 0 and "assessment"."result"."competency_count"),
	CONSTRAINT "result_confidence_check" CHECK ("assessment"."result"."confidence" in ('High', 'Medium', 'Low'))
);
--> statement-breakpoint
ALTER TABLE "assessment"."result" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "result_candidate_job_idx" ON "assessment"."result" USING btree ("workspace_id","candidate_id","job_id","assessed_at");--> statement-breakpoint
CREATE POLICY "result_tenant_isolation" ON "assessment"."result" AS PERMISSIVE FOR ALL TO public USING ("assessment"."result"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("assessment"."result"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);