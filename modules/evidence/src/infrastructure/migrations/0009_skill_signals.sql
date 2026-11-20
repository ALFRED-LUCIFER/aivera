CREATE TABLE "evidence"."repository_skill_grade" (
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"rubric_version_id" uuid NOT NULL,
	"competency_id" uuid NOT NULL,
	"skill" text NOT NULL,
	"grade" text NOT NULL,
	"reason" text NOT NULL,
	"citations" jsonb NOT NULL,
	CONSTRAINT "repository_skill_grade_pkey" PRIMARY KEY("workspace_id","source_id","rubric_version_id","competency_id","skill"),
	CONSTRAINT "repository_skill_grade_grade_check" CHECK ("evidence"."repository_skill_grade"."grade" in ('STRONG', 'PARTIAL', 'NO_EVIDENCE', 'UNABLE_TO_VERIFY')),
	CONSTRAINT "repository_skill_grade_reason_check" CHECK ("evidence"."repository_skill_grade"."reason" in ('code_corroborated', 'code_files', 'declaration_only', 'single_code_file', 'not_found',
          'not_detectable', 'unreadable', 'rate_limited', 'truncated_listing', 'file_cap', 'oversized_file')),
	CONSTRAINT "repository_skill_grade_citations_check" CHECK (jsonb_array_length("evidence"."repository_skill_grade"."citations") <= 6)
);
--> statement-breakpoint
ALTER TABLE "evidence"."repository_skill_grade" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evidence"."repository_skill_signal" (
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"skill" text NOT NULL,
	"path" text NOT NULL,
	"kind" text NOT NULL,
	"weight" text NOT NULL,
	"detail" text NOT NULL,
	CONSTRAINT "repository_skill_signal_pkey" PRIMARY KEY("workspace_id","source_id","position"),
	CONSTRAINT "repository_skill_signal_kind_check" CHECK ("evidence"."repository_skill_signal"."kind" in ('manifest', 'config', 'path', 'readme')),
	CONSTRAINT "repository_skill_signal_weight_check" CHECK ("evidence"."repository_skill_signal"."weight" in ('code', 'declaration')),
	CONSTRAINT "repository_skill_signal_detail_check" CHECK (char_length("evidence"."repository_skill_signal"."detail") <= 160)
);
--> statement-breakpoint
ALTER TABLE "evidence"."repository_skill_signal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence"."repository_read" ADD COLUMN "files_inspected" integer;--> statement-breakpoint
ALTER TABLE "evidence"."repository_read" ADD COLUMN "coverage_gap" text;--> statement-breakpoint
ALTER TABLE "evidence"."repository_skill_grade" ADD CONSTRAINT "repository_skill_grade_read_fk" FOREIGN KEY ("workspace_id","source_id") REFERENCES "evidence"."repository_read"("workspace_id","source_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence"."repository_skill_signal" ADD CONSTRAINT "repository_skill_signal_read_fk" FOREIGN KEY ("workspace_id","source_id") REFERENCES "evidence"."repository_read"("workspace_id","source_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repository_skill_grade_rubric_idx" ON "evidence"."repository_skill_grade" USING btree ("workspace_id","rubric_version_id");--> statement-breakpoint
ALTER TABLE "evidence"."repository_read" ADD CONSTRAINT "repository_read_coverage_gap_check" CHECK ("evidence"."repository_read"."coverage_gap" in ('unreadable', 'rate_limited', 'truncated_listing', 'file_cap', 'oversized_file'));--> statement-breakpoint
ALTER TABLE "evidence"."repository_read" ADD CONSTRAINT "repository_read_files_inspected_check" CHECK ("evidence"."repository_read"."files_inspected" >= 0);--> statement-breakpoint
CREATE POLICY "repository_skill_grade_tenant_isolation" ON "evidence"."repository_skill_grade" AS PERMISSIVE FOR ALL TO public USING ("evidence"."repository_skill_grade"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."repository_skill_grade"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "repository_skill_signal_tenant_isolation" ON "evidence"."repository_skill_signal" AS PERMISSIVE FOR ALL TO public USING ("evidence"."repository_skill_signal"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."repository_skill_signal"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);