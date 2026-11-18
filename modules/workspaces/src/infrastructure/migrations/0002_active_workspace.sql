CREATE TABLE "workspaces"."active_workspace" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces"."active_workspace" ADD CONSTRAINT "active_workspace_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"."workspace"("id") ON DELETE no action ON UPDATE no action;