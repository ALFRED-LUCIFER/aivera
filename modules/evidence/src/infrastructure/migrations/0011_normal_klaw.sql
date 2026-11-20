ALTER TABLE "evidence"."repository_read" ALTER COLUMN "github_login" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence"."repository_read" ADD COLUMN "url" text NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence"."repository_read" ADD CONSTRAINT "repository_read_candidate_url_key" UNIQUE("workspace_id","candidate_id","url");