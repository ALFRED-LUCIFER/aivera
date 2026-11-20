CREATE TABLE "evidence"."comparison" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"mapping_id" uuid NOT NULL,
	"competency_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"other_item_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"resolution_limit" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "comparison_outcome_check" CHECK ("evidence"."comparison"."outcome" in ('agreement', 'contradiction')),
	CONSTRAINT "comparison_items_check" CHECK ("evidence"."comparison"."item_id" <> "evidence"."comparison"."other_item_id"),
	CONSTRAINT "comparison_resolution_check" CHECK (("evidence"."comparison"."resolved_at" is null) = ("evidence"."comparison"."resolved_by" is null)
          and ("evidence"."comparison"."resolved_at" is null) = (coalesce(btrim("evidence"."comparison"."resolution_note"), '') = '')
          and ("evidence"."comparison"."resolved_at" is null) = (coalesce(btrim("evidence"."comparison"."resolution_limit"), '') = '')
          and ("evidence"."comparison"."resolved_at" is null or "evidence"."comparison"."outcome" = 'contradiction'))
);
--> statement-breakpoint
ALTER TABLE "evidence"."comparison" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence"."comparison" ADD CONSTRAINT "comparison_mapping_fk" FOREIGN KEY ("workspace_id","mapping_id") REFERENCES "evidence"."mapping"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence"."comparison" ADD CONSTRAINT "comparison_item_fk" FOREIGN KEY ("workspace_id","item_id") REFERENCES "evidence"."item"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence"."comparison" ADD CONSTRAINT "comparison_other_item_fk" FOREIGN KEY ("workspace_id","other_item_id") REFERENCES "evidence"."item"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comparison_candidate_job_idx" ON "evidence"."comparison" USING btree ("workspace_id","candidate_id","job_id");--> statement-breakpoint
CREATE INDEX "comparison_mapping_idx" ON "evidence"."comparison" USING btree ("workspace_id","mapping_id");--> statement-breakpoint
CREATE POLICY "comparison_tenant_isolation" ON "evidence"."comparison" AS PERMISSIVE FOR ALL TO public USING ("evidence"."comparison"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."comparison"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);