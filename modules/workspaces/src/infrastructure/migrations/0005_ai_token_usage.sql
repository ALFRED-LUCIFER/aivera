CREATE TABLE "workspaces"."ai_token_usage" (
	"workspace_id" uuid NOT NULL,
	"usage_day" date NOT NULL,
	"tokens" bigint NOT NULL,
	CONSTRAINT "ai_token_usage_workspace_id_usage_day_pk" PRIMARY KEY("workspace_id","usage_day"),
	CONSTRAINT "ai_token_usage_tokens_check" CHECK ("workspaces"."ai_token_usage"."tokens" >= 0)
);
--> statement-breakpoint
ALTER TABLE "workspaces"."ai_token_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspaces"."ai_token_usage" ADD CONSTRAINT "ai_token_usage_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "ai_token_usage_tenant_isolation" ON "workspaces"."ai_token_usage" AS PERMISSIVE FOR ALL TO public USING ("workspaces"."ai_token_usage"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspaces"."ai_token_usage"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);