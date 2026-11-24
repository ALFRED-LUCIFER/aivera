CREATE TABLE "candidates"."merge" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"survivor_id" uuid NOT NULL,
	"merged_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"automatic" boolean NOT NULL,
	"merged_by" uuid,
	"merged_at" timestamp with time zone NOT NULL,
	"undo_until" timestamp with time zone NOT NULL,
	"moved" jsonb NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" uuid,
	"undo_reason" text,
	CONSTRAINT "merge_people_check" CHECK ("candidates"."merge"."survivor_id" <> "candidates"."merge"."merged_id"),
	CONSTRAINT "merge_reason_check" CHECK (btrim("candidates"."merge"."reason") <> ''),
	CONSTRAINT "merge_undone_check" CHECK (("candidates"."merge"."undone_at" is null) = ("candidates"."merge"."undone_by" is null) and ("candidates"."merge"."undone_at" is null) = ("candidates"."merge"."undo_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "candidates"."merge" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "candidates"."merge" ADD CONSTRAINT "merge_survivor_fk" FOREIGN KEY ("workspace_id","survivor_id") REFERENCES "candidates"."person"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates"."merge" ADD CONSTRAINT "merge_merged_fk" FOREIGN KEY ("workspace_id","merged_id") REFERENCES "candidates"."person"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merge_active_key" ON "candidates"."merge" USING btree ("workspace_id","merged_id") WHERE "candidates"."merge"."undone_at" is null;--> statement-breakpoint
CREATE INDEX "merge_survivor_idx" ON "candidates"."merge" USING btree ("workspace_id","survivor_id");--> statement-breakpoint
CREATE POLICY "merge_tenant_isolation" ON "candidates"."merge" AS PERMISSIVE FOR ALL TO public USING ("candidates"."merge"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("candidates"."merge"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);