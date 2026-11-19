CREATE TABLE "workspaces"."invitation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"title" text,
	"job_ids" uuid[] DEFAULT '{}' NOT NULL,
	"client_ids" uuid[] DEFAULT '{}' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitation_role_check" CHECK ("workspaces"."invitation"."role" in ('admin', 'recruiter', 'hiring_owner', 'interviewer')),
	CONSTRAINT "invitation_access_check" CHECK (("workspaces"."invitation"."role" in ('hiring_owner', 'interviewer')) = (cardinality("workspaces"."invitation"."job_ids") + cardinality("workspaces"."invitation"."client_ids") > 0))
);
--> statement-breakpoint
ALTER TABLE "workspaces"."invitation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspaces"."member" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "workspaces"."invitation" ADD CONSTRAINT "invitation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "invitation_tenant_isolation" ON "workspaces"."invitation" AS PERMISSIVE FOR ALL TO public USING ("workspaces"."invitation"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspaces"."invitation"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);