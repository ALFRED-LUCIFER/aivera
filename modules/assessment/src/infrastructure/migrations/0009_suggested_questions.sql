CREATE TABLE "assessment"."suggested_questions" (
	"result_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"prompt_version" text NOT NULL,
	"gaps" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessment"."suggested_questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assessment"."suggested_questions" ADD CONSTRAINT "suggested_questions_result_id_result_id_fk" FOREIGN KEY ("result_id") REFERENCES "assessment"."result"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "suggested_questions_tenant_isolation" ON "assessment"."suggested_questions" AS PERMISSIVE FOR ALL TO public USING ("assessment"."suggested_questions"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("assessment"."suggested_questions"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);