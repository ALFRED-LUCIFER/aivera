CREATE TABLE "workspaces"."directory" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces"."directory" ADD CONSTRAINT "directory_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"."workspace"("id") ON DELETE no action ON UPDATE no action;