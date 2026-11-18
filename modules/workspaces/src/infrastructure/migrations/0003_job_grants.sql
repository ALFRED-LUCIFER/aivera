CREATE TABLE "workspaces"."client" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_workspace_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "client_name_check" CHECK (btrim("workspaces"."client"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "workspaces"."client" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workspaces"."job_grant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid,
	"client_id" uuid,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_grant_member_target_key" UNIQUE NULLS NOT DISTINCT("workspace_id","user_id","job_id","client_id"),
	CONSTRAINT "job_grant_target_check" CHECK (("workspaces"."job_grant"."job_id" is null) <> ("workspaces"."job_grant"."client_id" is null))
);
--> statement-breakpoint
ALTER TABLE "workspaces"."job_grant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspaces"."workspace" ADD COLUMN "type" text DEFAULT 'in_house' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces"."client" ADD CONSTRAINT "client_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces"."job_grant" ADD CONSTRAINT "job_grant_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces"."job_grant" ADD CONSTRAINT "job_grant_workspace_id_user_id_member_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "workspaces"."member"("workspace_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces"."job_grant" ADD CONSTRAINT "job_grant_workspace_id_client_id_client_workspace_id_id_fk" FOREIGN KEY ("workspace_id","client_id") REFERENCES "workspaces"."client"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_workspace_name_idx" ON "workspaces"."client" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
ALTER TABLE "workspaces"."workspace" ADD CONSTRAINT "workspace_type_check" CHECK ("workspaces"."workspace"."type" in ('in_house', 'agency'));--> statement-breakpoint
CREATE POLICY "client_tenant_isolation" ON "workspaces"."client" AS PERMISSIVE FOR ALL TO public USING ("workspaces"."client"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspaces"."client"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "job_grant_tenant_isolation" ON "workspaces"."job_grant" AS PERMISSIVE FOR ALL TO public USING ("workspaces"."job_grant"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspaces"."job_grant"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);