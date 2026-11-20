CREATE TABLE "evidence"."cv_parse" (
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "cv_parse_pkey" PRIMARY KEY("workspace_id","source_id"),
	CONSTRAINT "cv_parse_status_check" CHECK ("evidence"."cv_parse"."status" in ('pending', 'parsed', 'unreadable', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "evidence"."cv_parse" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evidence"."source_note" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"excerpt" text NOT NULL,
	"excerpt_span" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "source_note_reason_check" CHECK ("evidence"."source_note"."reason" in ('instruction', 'role_marker', 'tool_call', 'hidden_text')),
	CONSTRAINT "source_note_excerpt_check" CHECK (btrim("evidence"."source_note"."excerpt") <> '')
);
--> statement-breakpoint
ALTER TABLE "evidence"."source_note" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence"."cv_parse" ADD CONSTRAINT "cv_parse_source_fk" FOREIGN KEY ("workspace_id","source_id","candidate_id") REFERENCES "evidence"."source"("workspace_id","id","candidate_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence"."source_note" ADD CONSTRAINT "source_note_source_fk" FOREIGN KEY ("workspace_id","source_id","candidate_id") REFERENCES "evidence"."source"("workspace_id","id","candidate_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_note_source_idx" ON "evidence"."source_note" USING btree ("workspace_id","source_id");--> statement-breakpoint
CREATE INDEX "source_blob_file_idx" ON "evidence"."source" USING btree ("workspace_id","blob_file_id");--> statement-breakpoint
CREATE POLICY "cv_parse_tenant_isolation" ON "evidence"."cv_parse" AS PERMISSIVE FOR ALL TO public USING ("evidence"."cv_parse"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."cv_parse"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "source_note_tenant_isolation" ON "evidence"."source_note" AS PERMISSIVE FOR ALL TO public USING ("evidence"."source_note"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."source_note"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);