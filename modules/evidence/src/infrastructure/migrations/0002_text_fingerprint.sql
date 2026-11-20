CREATE TABLE "evidence"."duplicate_flag" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"other_source_id" uuid NOT NULL,
	"other_candidate_id" uuid NOT NULL,
	"similarity" double precision NOT NULL,
	"resolution" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "duplicate_flag_pair_key" UNIQUE("workspace_id","source_id","other_source_id"),
	CONSTRAINT "duplicate_flag_candidates_check" CHECK ("evidence"."duplicate_flag"."candidate_id" <> "evidence"."duplicate_flag"."other_candidate_id"),
	CONSTRAINT "duplicate_flag_similarity_check" CHECK ("evidence"."duplicate_flag"."similarity" between 0 and 1),
	CONSTRAINT "duplicate_flag_resolution_check" CHECK ("evidence"."duplicate_flag"."resolution" in ('shared_group_project', 'same_template', 'needs_follow_up')),
	CONSTRAINT "duplicate_flag_resolved_check" CHECK (("evidence"."duplicate_flag"."resolution" is null) = ("evidence"."duplicate_flag"."resolved_by" is null) and ("evidence"."duplicate_flag"."resolution" is null) = ("evidence"."duplicate_flag"."resolved_at" is null))
);
--> statement-breakpoint
ALTER TABLE "evidence"."duplicate_flag" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence"."source" ADD COLUMN "text_fingerprint" text;--> statement-breakpoint
ALTER TABLE "evidence"."duplicate_flag" ADD CONSTRAINT "duplicate_flag_source_fk" FOREIGN KEY ("workspace_id","source_id","candidate_id") REFERENCES "evidence"."source"("workspace_id","id","candidate_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence"."duplicate_flag" ADD CONSTRAINT "duplicate_flag_other_source_fk" FOREIGN KEY ("workspace_id","other_source_id","other_candidate_id") REFERENCES "evidence"."source"("workspace_id","id","candidate_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "duplicate_flag_candidate_idx" ON "evidence"."duplicate_flag" USING btree ("workspace_id","candidate_id");--> statement-breakpoint
CREATE INDEX "duplicate_flag_other_candidate_idx" ON "evidence"."duplicate_flag" USING btree ("workspace_id","other_candidate_id");--> statement-breakpoint
ALTER TABLE "evidence"."source" ADD CONSTRAINT "source_text_fingerprint_check" CHECK ("evidence"."source"."text_fingerprint" ~ '^[0-9a-f]{16}$');--> statement-breakpoint
CREATE POLICY "duplicate_flag_tenant_isolation" ON "evidence"."duplicate_flag" AS PERMISSIVE FOR ALL TO public USING ("evidence"."duplicate_flag"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."duplicate_flag"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);