CREATE SCHEMA "fixture_notes";
--> statement-breakpoint
CREATE TABLE "fixture_notes"."notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fixture_notes"."notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "notes_workspace_isolation" ON "fixture_notes"."notes" AS PERMISSIVE FOR ALL TO public USING ("fixture_notes"."notes"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("fixture_notes"."notes"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);