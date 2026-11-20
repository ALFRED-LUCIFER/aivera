CREATE TABLE "evidence"."evidence_gap" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"mapping_id" uuid NOT NULL,
	"competency_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"files_inspected" integer,
	"coverage_reason" text,
	CONSTRAINT "evidence_gap_workspace_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "evidence_gap_competency_key" UNIQUE("workspace_id","mapping_id","competency_id"),
	CONSTRAINT "evidence_gap_kind_check" CHECK ("evidence"."evidence_gap"."kind" in ('not_found', 'unable_to_verify', 'no_evidence')),
	CONSTRAINT "evidence_gap_coverage_check" CHECK (("evidence"."evidence_gap"."kind" = 'no_evidence') = ("evidence"."evidence_gap"."files_inspected" is null)
          and ("evidence"."evidence_gap"."files_inspected" is null) = ("evidence"."evidence_gap"."coverage_reason" is null) and "evidence"."evidence_gap"."files_inspected" >= 0)
);
--> statement-breakpoint
ALTER TABLE "evidence"."evidence_gap" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evidence"."mapping" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"rubric_version_id" uuid NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mapping_workspace_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "mapping_changes_check" CHECK (jsonb_array_length("evidence"."mapping"."changes") <= 3)
);
--> statement-breakpoint
ALTER TABLE "evidence"."mapping" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence"."item" ADD COLUMN "mapping_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence"."evidence_gap" ADD CONSTRAINT "evidence_gap_mapping_fk" FOREIGN KEY ("workspace_id","mapping_id") REFERENCES "evidence"."mapping"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mapping_candidate_job_idx" ON "evidence"."mapping" USING btree ("workspace_id","candidate_id","job_id","created_at");--> statement-breakpoint
ALTER TABLE "evidence"."item" ADD CONSTRAINT "item_mapping_fk" FOREIGN KEY ("workspace_id","mapping_id") REFERENCES "evidence"."mapping"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "evidence_gap_tenant_isolation" ON "evidence"."evidence_gap" AS PERMISSIVE FOR ALL TO public USING ("evidence"."evidence_gap"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."evidence_gap"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "mapping_tenant_isolation" ON "evidence"."mapping" AS PERMISSIVE FOR ALL TO public USING ("evidence"."mapping"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."mapping"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);