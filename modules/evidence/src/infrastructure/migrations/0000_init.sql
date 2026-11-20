CREATE SCHEMA "evidence";
--> statement-breakpoint
CREATE TABLE "evidence"."competency_link" (
	"workspace_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"competency_id" uuid NOT NULL,
	CONSTRAINT "competency_link_pkey" PRIMARY KEY("workspace_id","item_id","competency_id")
);
--> statement-breakpoint
ALTER TABLE "evidence"."competency_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evidence"."item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"excerpt" text NOT NULL,
	"excerpt_span" text,
	"provenance" text NOT NULL,
	"strength" text NOT NULL,
	"limit_statement" text NOT NULL,
	"synthetic" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "item_workspace_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "item_provenance_check" CHECK ("evidence"."item"."provenance" in ('corroborated', 'submitted', 'claim', 'contradictory', 'awaiting-defence')),
	CONSTRAINT "item_strength_check" CHECK ("evidence"."item"."strength" in ('strong', 'medium', 'supporting', 'claim')),
	CONSTRAINT "item_claim_strength_check" CHECK ("evidence"."item"."provenance" not in ('claim', 'awaiting-defence') or "evidence"."item"."strength" in ('supporting', 'claim')),
	CONSTRAINT "item_limit_check" CHECK (btrim("evidence"."item"."limit_statement") <> ''),
	CONSTRAINT "item_excerpt_check" CHECK (btrim("evidence"."item"."excerpt") <> '')
);
--> statement-breakpoint
ALTER TABLE "evidence"."item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evidence"."outbox" (
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
ALTER TABLE "evidence"."outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evidence"."source" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"url" text,
	"blob_file_id" text,
	"captured_at" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone,
	"check_method" text,
	"synthetic" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "source_workspace_candidate_key" UNIQUE("workspace_id","id","candidate_id"),
	CONSTRAINT "source_kind_check" CHECK ("evidence"."source"."kind" in ('cv', 'repository', 'document', 'shipped_product', 'reference_call', 'portal_submission', 'interview_note')),
	CONSTRAINT "source_url_check" CHECK ("evidence"."source"."url" is null or "evidence"."source"."url" like 'https://%')
);
--> statement-breakpoint
ALTER TABLE "evidence"."source" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evidence"."competency_link" ADD CONSTRAINT "competency_link_item_fk" FOREIGN KEY ("workspace_id","item_id") REFERENCES "evidence"."item"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence"."item" ADD CONSTRAINT "item_source_fk" FOREIGN KEY ("workspace_id","source_id","candidate_id") REFERENCES "evidence"."source"("workspace_id","id","candidate_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competency_link_job_idx" ON "evidence"."competency_link" USING btree ("workspace_id","job_id");--> statement-breakpoint
CREATE INDEX "item_candidate_idx" ON "evidence"."item" USING btree ("workspace_id","candidate_id","created_at","id");--> statement-breakpoint
CREATE INDEX "outbox_unsent_idx" ON "evidence"."outbox" USING btree ("next_attempt_at") WHERE "evidence"."outbox"."sent_at" is null;--> statement-breakpoint
CREATE POLICY "competency_link_tenant_isolation" ON "evidence"."competency_link" AS PERMISSIVE FOR ALL TO public USING ("evidence"."competency_link"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."competency_link"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "item_tenant_isolation" ON "evidence"."item" AS PERMISSIVE FOR ALL TO public USING ("evidence"."item"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."item"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "outbox_tenant_isolation" ON "evidence"."outbox" AS PERMISSIVE FOR ALL TO public USING ("evidence"."outbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."outbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "outbox_relay_read" ON "evidence"."outbox" AS PERMISSIVE FOR SELECT TO "aivera_relay" USING (true);--> statement-breakpoint
CREATE POLICY "outbox_relay_mark" ON "evidence"."outbox" AS PERMISSIVE FOR UPDATE TO "aivera_relay" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "source_tenant_isolation" ON "evidence"."source" AS PERMISSIVE FOR ALL TO public USING ("evidence"."source"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("evidence"."source"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);