CREATE TABLE "evidence"."link_read" (
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"url" text NOT NULL,
	"status" text NOT NULL,
	"title" text,
	CONSTRAINT "link_read_pkey" PRIMARY KEY("workspace_id","source_id"),
	CONSTRAINT "link_read_candidate_url_key" UNIQUE("workspace_id","candidate_id","url"),
	CONSTRAINT "link_read_status_check" CHECK ("evidence"."link_read"."status" in ('pending', 'read', 'not_reachable', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "evidence"."link_read" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence"."link_read" ADD CONSTRAINT "link_read_source_fk" FOREIGN KEY ("workspace_id","source_id","candidate_id") REFERENCES "evidence"."source"("workspace_id","id","candidate_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "link_read_tenant_isolation" ON "evidence"."link_read" AS PERMISSIVE FOR ALL TO public USING ("evidence"."link_read"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."link_read"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);