CREATE TABLE "intake"."import_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"confirmed_by" uuid NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"wording_key" text NOT NULL,
	"wording_version" text NOT NULL,
	"cvs" integer NOT NULL,
	CONSTRAINT "import_batches_workspace_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "import_batches_cvs_check" CHECK ("intake"."import_batches"."cvs" >= 1)
);
--> statement-breakpoint
ALTER TABLE "intake"."import_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intake"."application_source" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "intake"."application_source" ADD CONSTRAINT "application_source_batch_fk" FOREIGN KEY ("workspace_id","batch_id") REFERENCES "intake"."import_batches"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "import_batches_tenant_isolation" ON "intake"."import_batches" AS PERMISSIVE FOR ALL TO public USING ("intake"."import_batches"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("intake"."import_batches"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);