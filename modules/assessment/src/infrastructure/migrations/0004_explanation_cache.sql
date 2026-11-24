CREATE TABLE "assessment"."explanation" (
	"result_id" uuid NOT NULL,
	"prompt_version" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"statements" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "explanation_result_id_prompt_version_pk" PRIMARY KEY("result_id","prompt_version")
);
--> statement-breakpoint
ALTER TABLE "assessment"."explanation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "explanation_tenant_isolation" ON "assessment"."explanation" AS PERMISSIVE FOR ALL TO public USING ("assessment"."explanation"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("assessment"."explanation"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);