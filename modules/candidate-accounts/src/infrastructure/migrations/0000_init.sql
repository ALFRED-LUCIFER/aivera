CREATE SCHEMA "candidate_accounts";
--> statement-breakpoint
CREATE TABLE "candidate_accounts"."account" (
	"identity_user_id" uuid PRIMARY KEY NOT NULL,
	"full_name" text,
	"work_type" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "account_work_type_check" CHECK ("candidate_accounts"."account"."work_type" in ('software_engineering', 'qa_test_automation', 'ai_llm_engineering', 'forward_deployed_engineering', 'data_ml', 'devops_sre', 'product_management', 'product_design', 'sales', 'technical_writing_support'))
);
--> statement-breakpoint
ALTER TABLE "candidate_accounts"."account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "candidate_accounts"."consent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"workspace_id" uuid,
	"job_id" uuid,
	"granted_at" timestamp with time zone NOT NULL,
	"text_version" text NOT NULL,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "consent_account_id_key" UNIQUE("account_id","id"),
	CONSTRAINT "consent_purpose_check" CHECK ("candidate_accounts"."consent"."purpose" in ('apply_to_job', 'answer_evidence_request', 'cv_check')),
	CONSTRAINT "consent_text_version_check" CHECK (btrim("candidate_accounts"."consent"."text_version") <> ''),
	CONSTRAINT "consent_target_check" CHECK (case when "candidate_accounts"."consent"."purpose" = 'cv_check' then "candidate_accounts"."consent"."workspace_id" is null and "candidate_accounts"."consent"."job_id" is null else "candidate_accounts"."consent"."workspace_id" is not null and "candidate_accounts"."consent"."job_id" is not null end),
	CONSTRAINT "consent_withdrawn_check" CHECK ("candidate_accounts"."consent"."withdrawn_at" is null or "candidate_accounts"."consent"."withdrawn_at" >= "candidate_accounts"."consent"."granted_at")
);
--> statement-breakpoint
ALTER TABLE "candidate_accounts"."consent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "candidate_accounts"."profile" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"headline" text,
	"location" text
);
--> statement-breakpoint
ALTER TABLE "candidate_accounts"."profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "candidate_accounts"."workspace_link" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workspace_candidate_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"consent_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_link_account_workspace_candidate_key" UNIQUE("account_id","workspace_id","workspace_candidate_id"),
	CONSTRAINT "workspace_link_reason_check" CHECK ("candidate_accounts"."workspace_link"."reason" in ('applied', 'answered_evidence_request'))
);
--> statement-breakpoint
ALTER TABLE "candidate_accounts"."workspace_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "candidate_accounts"."consent" ADD CONSTRAINT "consent_account_id_account_identity_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "candidate_accounts"."account"("identity_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_accounts"."profile" ADD CONSTRAINT "profile_account_id_account_identity_user_id_fk" FOREIGN KEY ("account_id") REFERENCES "candidate_accounts"."account"("identity_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_accounts"."workspace_link" ADD CONSTRAINT "workspace_link_consent_fk" FOREIGN KEY ("account_id","consent_id") REFERENCES "candidate_accounts"."consent"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_account_granted_idx" ON "candidate_accounts"."consent" USING btree ("account_id","granted_at");--> statement-breakpoint
CREATE POLICY "account_owner_isolation" ON "candidate_accounts"."account" AS PERMISSIVE FOR ALL TO public USING ("candidate_accounts"."account"."identity_user_id" = nullif(current_setting('app.candidate_account_id', true), '')::uuid) WITH CHECK ("candidate_accounts"."account"."identity_user_id" = nullif(current_setting('app.candidate_account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "consent_owner_isolation" ON "candidate_accounts"."consent" AS PERMISSIVE FOR ALL TO public USING ("candidate_accounts"."consent"."account_id" = nullif(current_setting('app.candidate_account_id', true), '')::uuid) WITH CHECK ("candidate_accounts"."consent"."account_id" = nullif(current_setting('app.candidate_account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "profile_owner_isolation" ON "candidate_accounts"."profile" AS PERMISSIVE FOR ALL TO public USING ("candidate_accounts"."profile"."account_id" = nullif(current_setting('app.candidate_account_id', true), '')::uuid) WITH CHECK ("candidate_accounts"."profile"."account_id" = nullif(current_setting('app.candidate_account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "workspace_link_owner_isolation" ON "candidate_accounts"."workspace_link" AS PERMISSIVE FOR ALL TO public USING ("candidate_accounts"."workspace_link"."account_id" = nullif(current_setting('app.candidate_account_id', true), '')::uuid) WITH CHECK ("candidate_accounts"."workspace_link"."account_id" = nullif(current_setting('app.candidate_account_id', true), '')::uuid);