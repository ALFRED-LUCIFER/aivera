CREATE SCHEMA "workspaces";
--> statement-breakpoint
CREATE TABLE "workspaces"."member" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "member_role_check" CHECK ("workspaces"."member"."role" in ('admin', 'recruiter', 'hiring_owner', 'interviewer')),
	CONSTRAINT "member_status_check" CHECK ("workspaces"."member"."status" in ('invited', 'active', 'removed'))
);
--> statement-breakpoint
ALTER TABLE "workspaces"."member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workspaces"."workspace" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"company" text NOT NULL,
	"hiring_focus" text NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces"."workspace" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspaces"."member" ADD CONSTRAINT "member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "member_tenant_isolation" ON "workspaces"."member" AS PERMISSIVE FOR ALL TO public USING ("workspaces"."member"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspaces"."member"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "workspace_tenant_isolation" ON "workspaces"."workspace" AS PERMISSIVE FOR ALL TO public USING ("workspaces"."workspace"."id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspaces"."workspace"."id" = nullif(current_setting('app.workspace_id', true), '')::uuid);