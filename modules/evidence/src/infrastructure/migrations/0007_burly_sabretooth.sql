CREATE TABLE "evidence"."portal_token" (
	"workspace_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "portal_token_pkey" PRIMARY KEY("workspace_id","request_id"),
	CONSTRAINT "portal_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "portal_token_hash_check" CHECK ("evidence"."portal_token"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "evidence"."portal_token" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evidence"."request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"message" text,
	"status" text NOT NULL,
	"follow_up_after_days" smallint DEFAULT 2 NOT NULL,
	"follow_up_max_count" smallint DEFAULT 2 NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "request_workspace_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "request_status_check" CHECK ("evidence"."request"."status" in ('draft', 'sent', 'opened', 'answered', 'quiet', 'closed')),
	CONSTRAINT "request_sent_check" CHECK (("evidence"."request"."status" = 'draft') = ("evidence"."request"."sent_at" is null) or "evidence"."request"."status" = 'closed'),
	CONSTRAINT "request_follow_up_check" CHECK ("evidence"."request"."follow_up_after_days" >= 1 and "evidence"."request"."follow_up_max_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "evidence"."request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evidence"."request_item" (
	"workspace_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"competency_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"claim" text NOT NULL,
	CONSTRAINT "request_item_pkey" PRIMARY KEY("workspace_id","request_id","competency_id")
);
--> statement-breakpoint
ALTER TABLE "evidence"."request_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence"."portal_token" ADD CONSTRAINT "portal_token_request_fk" FOREIGN KEY ("workspace_id","request_id") REFERENCES "evidence"."request"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence"."request_item" ADD CONSTRAINT "request_item_request_fk" FOREIGN KEY ("workspace_id","request_id") REFERENCES "evidence"."request"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence"."request_item" ADD CONSTRAINT "request_item_item_fk" FOREIGN KEY ("workspace_id","item_id") REFERENCES "evidence"."item"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "request_open_key" ON "evidence"."request" USING btree ("workspace_id","candidate_id","job_id") WHERE "evidence"."request"."status" <> 'closed';--> statement-breakpoint
CREATE POLICY "portal_token_tenant_isolation" ON "evidence"."portal_token" AS PERMISSIVE FOR ALL TO public USING ("evidence"."portal_token"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."portal_token"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "request_tenant_isolation" ON "evidence"."request" AS PERMISSIVE FOR ALL TO public USING ("evidence"."request"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."request"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "request_item_tenant_isolation" ON "evidence"."request_item" AS PERMISSIVE FOR ALL TO public USING ("evidence"."request_item"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."request_item"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);