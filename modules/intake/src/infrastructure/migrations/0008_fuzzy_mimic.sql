CREATE TABLE "intake"."sheet_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"problem" text,
	"headers" text[],
	"mapping" jsonb,
	"rows" jsonb,
	CONSTRAINT "sheet_imports_status_check" CHECK ("intake"."sheet_imports"."status" in ('reading', 'mapping', 'fetching', 'ready', 'unreadable', 'added'))
);
--> statement-breakpoint
ALTER TABLE "intake"."sheet_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intake"."application_source" DROP CONSTRAINT "application_source_source_check";--> statement-breakpoint
ALTER TABLE "intake"."application_source" ADD CONSTRAINT "application_source_source_check" CHECK ("intake"."application_source"."source" in ('linkedin', 'careers_page', 'referral', 'email', 'whatsapp', 'recruiter', 'spreadsheet'));--> statement-breakpoint
CREATE POLICY "sheet_imports_tenant_isolation" ON "intake"."sheet_imports" AS PERMISSIVE FOR ALL TO public USING ("intake"."sheet_imports"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("intake"."sheet_imports"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);