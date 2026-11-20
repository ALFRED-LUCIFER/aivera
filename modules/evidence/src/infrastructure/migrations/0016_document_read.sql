CREATE TABLE "evidence"."document_read" (
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "document_read_pkey" PRIMARY KEY("workspace_id","source_id"),
	CONSTRAINT "document_read_status_check" CHECK ("evidence"."document_read"."status" in ('pending', 'read', 'unreadable', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "evidence"."document_read" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence"."document_read" ADD CONSTRAINT "document_read_source_fk" FOREIGN KEY ("workspace_id","source_id","candidate_id") REFERENCES "evidence"."source"("workspace_id","id","candidate_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "document_read_tenant_isolation" ON "evidence"."document_read" AS PERMISSIVE FOR ALL TO public USING ("evidence"."document_read"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."document_read"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);