CREATE TABLE "evidence"."profile_expansion" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"login" text NOT NULL,
	"synthetic" boolean NOT NULL,
	"status" text NOT NULL,
	"queued" integer,
	CONSTRAINT "profile_expansion_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "profile_expansion_candidate_login_key" UNIQUE("workspace_id","candidate_id","login"),
	CONSTRAINT "profile_expansion_status_check" CHECK ("evidence"."profile_expansion"."status" in ('pending', 'expanded', 'not_expandable'))
);
--> statement-breakpoint
ALTER TABLE "evidence"."profile_expansion" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence"."repository_read" ADD COLUMN "via" text;--> statement-breakpoint
ALTER TABLE "evidence"."repository_read" ADD CONSTRAINT "repository_read_via_check" CHECK ("evidence"."repository_read"."via" in ('cv_profile'));--> statement-breakpoint
CREATE POLICY "profile_expansion_tenant_isolation" ON "evidence"."profile_expansion" AS PERMISSIVE FOR ALL TO public USING ("evidence"."profile_expansion"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."profile_expansion"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);