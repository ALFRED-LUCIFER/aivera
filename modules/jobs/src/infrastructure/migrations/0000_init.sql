CREATE SCHEMA "jobs";
--> statement-breakpoint
CREATE TABLE "jobs"."competency" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"rubric_version_id" uuid NOT NULL,
	"name" text NOT NULL,
	"evidence_expected" text NOT NULL,
	"weight_percent" integer NOT NULL,
	"level_needed" integer NOT NULL,
	"type" text NOT NULL,
	"origin" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "competency_version_position_key" UNIQUE("workspace_id","rubric_version_id","position"),
	CONSTRAINT "competency_weight_check" CHECK ("jobs"."competency"."weight_percent" between 1 and 100),
	CONSTRAINT "competency_level_check" CHECK ("jobs"."competency"."level_needed" between 1 and 5),
	CONSTRAINT "competency_type_check" CHECK ("jobs"."competency"."type" in ('mandatory', 'desirable')),
	CONSTRAINT "competency_origin_check" CHECK ("jobs"."competency"."origin" in ('from_description', 'suggested_by_aivera'))
);
--> statement-breakpoint
ALTER TABLE "jobs"."competency" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "jobs"."job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"job_type" text NOT NULL,
	"description" text NOT NULL,
	"team" text,
	"client_id" uuid,
	"location" text,
	"hiring_owner_user_id" uuid,
	"stage" text NOT NULL,
	"published" boolean NOT NULL,
	"pay_min_minor" integer,
	"pay_max_minor" integer,
	"pay_currency" text,
	"synthetic" boolean NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "job_workspace_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "job_title_check" CHECK (btrim("jobs"."job"."title") <> ''),
	CONSTRAINT "job_type_check" CHECK ("jobs"."job"."job_type" in ('software_engineering', 'qa_test_automation', 'ai_llm_engineering', 'forward_deployed_engineering', 'data_ml', 'devops_sre', 'product_management', 'product_design', 'sales', 'technical_writing_support')),
	CONSTRAINT "job_stage_check" CHECK ("jobs"."job"."stage" in ('defining_rubric', 'collecting_evidence', 'round_1', 'decision', 'closed')),
	CONSTRAINT "job_pay_band_check" CHECK (("jobs"."job"."pay_min_minor" is null and "jobs"."job"."pay_max_minor" is null and "jobs"."job"."pay_currency" is null) or (0 <= "jobs"."job"."pay_min_minor" and "jobs"."job"."pay_min_minor" <= "jobs"."job"."pay_max_minor" and "jobs"."job"."pay_currency" ~ '^[A-Z]{3}$'))
);
--> statement-breakpoint
ALTER TABLE "jobs"."job" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "jobs"."rubric_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"success_statement" text NOT NULL,
	"change_note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	CONSTRAINT "rubric_version_workspace_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "rubric_version_job_version_key" UNIQUE("workspace_id","job_id","version"),
	CONSTRAINT "rubric_version_version_check" CHECK ("jobs"."rubric_version"."version" >= 1),
	CONSTRAINT "rubric_version_status_check" CHECK ("jobs"."rubric_version"."status" in ('draft', 'awaiting_approval', 'approved', 'superseded', 'returned')),
	CONSTRAINT "rubric_version_approval_check" CHECK (("jobs"."rubric_version"."status" in ('approved', 'superseded')) = ("jobs"."rubric_version"."approved_by" is not null and "jobs"."rubric_version"."approved_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "jobs"."rubric_version" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs"."competency" ADD CONSTRAINT "competency_rubric_version_fk" FOREIGN KEY ("workspace_id","rubric_version_id") REFERENCES "jobs"."rubric_version"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs"."rubric_version" ADD CONSTRAINT "rubric_version_job_fk" FOREIGN KEY ("workspace_id","job_id") REFERENCES "jobs"."job"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_workspace_created_idx" ON "jobs"."job" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "rubric_version_one_approved_idx" ON "jobs"."rubric_version" USING btree ("workspace_id","job_id") WHERE "jobs"."rubric_version"."status" = 'approved';--> statement-breakpoint
CREATE POLICY "competency_tenant_isolation" ON "jobs"."competency" AS PERMISSIVE FOR ALL TO public USING ("jobs"."competency"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("jobs"."competency"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "competency_job_scope" ON "jobs"."competency" AS RESTRICTIVE FOR ALL TO public USING (exists (select 1 from "jobs"."rubric_version" where "jobs"."rubric_version"."id" = "jobs"."competency"."rubric_version_id")) WITH CHECK (exists (select 1 from "jobs"."rubric_version" where "jobs"."rubric_version"."id" = "jobs"."competency"."rubric_version_id"));--> statement-breakpoint
CREATE POLICY "job_tenant_isolation" ON "jobs"."job" AS PERMISSIVE FOR ALL TO public USING ("jobs"."job"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("jobs"."job"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "job_scope" ON "jobs"."job" AS RESTRICTIVE FOR ALL TO public USING ((nullif(current_setting('app.job_scope', true), '') = 'all' or "jobs"."job"."id" = any(nullif(current_setting('app.job_ids', true), '')::uuid[]) or "jobs"."job"."client_id" = any(nullif(current_setting('app.client_ids', true), '')::uuid[]))) WITH CHECK ((nullif(current_setting('app.job_scope', true), '') = 'all' or "jobs"."job"."id" = any(nullif(current_setting('app.job_ids', true), '')::uuid[]) or "jobs"."job"."client_id" = any(nullif(current_setting('app.client_ids', true), '')::uuid[])));--> statement-breakpoint
CREATE POLICY "rubric_version_tenant_isolation" ON "jobs"."rubric_version" AS PERMISSIVE FOR ALL TO public USING ("jobs"."rubric_version"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("jobs"."rubric_version"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "rubric_version_job_scope" ON "jobs"."rubric_version" AS RESTRICTIVE FOR ALL TO public USING (exists (select 1 from "jobs"."job" where "jobs"."job"."id" = "jobs"."rubric_version"."job_id")) WITH CHECK (exists (select 1 from "jobs"."job" where "jobs"."job"."id" = "jobs"."rubric_version"."job_id"));