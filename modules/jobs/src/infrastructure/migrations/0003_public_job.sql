CREATE TABLE "jobs"."public_job" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"job_type" text NOT NULL,
	"descriptor" text NOT NULL,
	"location" text,
	"pay_min_minor" integer,
	"pay_max_minor" integer,
	"pay_currency" text,
	"competencies" jsonb NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"open" boolean NOT NULL,
	CONSTRAINT "public_job_slug_key" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "jobs"."public_job" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "jobs"."public_job" ADD CONSTRAINT "public_job_job_fk" FOREIGN KEY ("workspace_id","job_id") REFERENCES "jobs"."job"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "public_job_open_posted_idx" ON "jobs"."public_job" USING btree ("open","posted_at");--> statement-breakpoint
CREATE POLICY "public_job_tenant_isolation" ON "jobs"."public_job" AS PERMISSIVE FOR ALL TO public USING ("jobs"."public_job"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("jobs"."public_job"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "public_job_public_read" ON "jobs"."public_job" AS PERMISSIVE FOR SELECT TO public USING (current_user = 'aivera_public');