CREATE TABLE "evidence"."mapping_failure" (
	"workspace_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"failed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mapping_failure_pkey" PRIMARY KEY("workspace_id","candidate_id","job_id")
);
--> statement-breakpoint
ALTER TABLE "evidence"."mapping_failure" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "mapping_failure_tenant_isolation" ON "evidence"."mapping_failure" AS PERMISSIVE FOR ALL TO public USING ("evidence"."mapping_failure"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."mapping_failure"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);