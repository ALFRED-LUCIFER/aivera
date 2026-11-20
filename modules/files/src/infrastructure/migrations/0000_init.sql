CREATE SCHEMA "files";
--> statement-breakpoint
CREATE TABLE "files"."file" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"candidate_account_id" uuid,
	"purpose" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text,
	"status" text NOT NULL,
	"blob_path" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "file_one_owner_check" CHECK (num_nonnulls("files"."file"."workspace_id", "files"."file"."candidate_account_id") = 1),
	CONSTRAINT "file_purpose_check" CHECK ("files"."file"."purpose" in ('cv', 'evidence', 'portal')),
	CONSTRAINT "file_status_check" CHECK ("files"."file"."status" in ('pending', 'clean', 'infected', 'rejected')),
	CONSTRAINT "file_size_check" CHECK ("files"."file"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "files"."file" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "files"."outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"correlation_id" text,
	"dedupe_key" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "outbox_workspace_dedupe_key" UNIQUE("workspace_id","dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "files"."outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "outbox_unsent_idx" ON "files"."outbox" USING btree ("next_attempt_at") WHERE "files"."outbox"."sent_at" is null;--> statement-breakpoint
CREATE POLICY "file_tenant_isolation" ON "files"."file" AS PERMISSIVE FOR ALL TO public USING ("files"."file"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("files"."file"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "file_owner_isolation" ON "files"."file" AS PERMISSIVE FOR ALL TO public USING ("files"."file"."candidate_account_id" = nullif(current_setting('app.candidate_account_id', true), '')::uuid) WITH CHECK ("files"."file"."candidate_account_id" = nullif(current_setting('app.candidate_account_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "outbox_tenant_isolation" ON "files"."outbox" AS PERMISSIVE FOR ALL TO public USING ("files"."outbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("files"."outbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "outbox_relay_read" ON "files"."outbox" AS PERMISSIVE FOR SELECT TO "aivera_relay" USING (true);--> statement-breakpoint
CREATE POLICY "outbox_relay_mark" ON "files"."outbox" AS PERMISSIVE FOR UPDATE TO "aivera_relay" USING (true) WITH CHECK (true);