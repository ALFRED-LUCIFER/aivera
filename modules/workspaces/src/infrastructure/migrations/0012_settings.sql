CREATE TABLE "workspaces"."settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "settings_value_check" CHECK (jsonb_typeof("workspaces"."settings"."value") = 'object')
);
--> statement-breakpoint
ALTER TABLE "workspaces"."settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspaces"."settings" ADD CONSTRAINT "settings_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "settings_tenant_isolation" ON "workspaces"."settings" AS PERMISSIVE FOR ALL TO public USING ("workspaces"."settings"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspaces"."settings"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);