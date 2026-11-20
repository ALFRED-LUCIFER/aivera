CREATE TABLE "evidence"."inbox" (
	"consumer" text NOT NULL,
	"message_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"handled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inbox_consumer_message_id_pk" PRIMARY KEY("consumer","message_id")
);
--> statement-breakpoint
ALTER TABLE "evidence"."inbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evidence"."merged_pull_request" (
	"workspace_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"repository" text NOT NULL,
	"number" integer NOT NULL,
	"merged_at" timestamp with time zone NOT NULL,
	"merged_by" text,
	"self_merged" boolean NOT NULL,
	CONSTRAINT "merged_pull_request_pkey" PRIMARY KEY("workspace_id","item_id"),
	CONSTRAINT "merged_pull_request_candidate_key" UNIQUE("workspace_id","candidate_id","repository","number")
);
--> statement-breakpoint
ALTER TABLE "evidence"."merged_pull_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evidence"."repository_read" (
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"github_login" text NOT NULL,
	"emails" text[] NOT NULL,
	"status" text NOT NULL,
	"total_commits" integer,
	"authored_commits" integer,
	"generated_only_commits" integer,
	"generated_checked" integer,
	"commits_truncated" boolean,
	"languages" jsonb,
	"pushed_at" timestamp with time zone,
	"has_tests" boolean,
	"has_ci" boolean,
	CONSTRAINT "repository_read_pkey" PRIMARY KEY("workspace_id","source_id"),
	CONSTRAINT "repository_read_status_check" CHECK ("evidence"."repository_read"."status" in ('pending', 'read', 'not_accessible', 'fork')),
	CONSTRAINT "repository_read_counts_check" CHECK ("evidence"."repository_read"."status" <> 'read' or ("evidence"."repository_read"."authored_commits" between 0 and "evidence"."repository_read"."total_commits"
          and "evidence"."repository_read"."generated_checked" between 0 and "evidence"."repository_read"."authored_commits"
          and "evidence"."repository_read"."generated_only_commits" between 0 and "evidence"."repository_read"."generated_checked"))
);
--> statement-breakpoint
ALTER TABLE "evidence"."repository_read" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence"."merged_pull_request" ADD CONSTRAINT "merged_pull_request_item_fk" FOREIGN KEY ("workspace_id","item_id") REFERENCES "evidence"."item"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence"."repository_read" ADD CONSTRAINT "repository_read_source_fk" FOREIGN KEY ("workspace_id","source_id","candidate_id") REFERENCES "evidence"."source"("workspace_id","id","candidate_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "inbox_tenant_isolation" ON "evidence"."inbox" AS PERMISSIVE FOR ALL TO public USING ("evidence"."inbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."inbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "merged_pull_request_tenant_isolation" ON "evidence"."merged_pull_request" AS PERMISSIVE FOR ALL TO public USING ("evidence"."merged_pull_request"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."merged_pull_request"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "repository_read_tenant_isolation" ON "evidence"."repository_read" AS PERMISSIVE FOR ALL TO public USING ("evidence"."repository_read"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."repository_read"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);