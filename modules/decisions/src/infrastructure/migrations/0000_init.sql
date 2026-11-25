CREATE SCHEMA "decisions";
--> statement-breakpoint
CREATE TABLE "decisions"."decision" (
	"workspace_id" uuid NOT NULL,
	"pack_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "decision_pkey" PRIMARY KEY("workspace_id","pack_id","candidate_id"),
	CONSTRAINT "decision_decision_check" CHECK ("decisions"."decision"."decision" in ('advance', 'hold', 'do_not_advance')),
	CONSTRAINT "decision_note_check" CHECK (btrim("decisions"."decision"."note") <> '' and char_length("decisions"."decision"."note") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "decisions"."decision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "decisions"."outbox" (
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
ALTER TABLE "decisions"."outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "decisions"."pack" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"rubric_version_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prepared_by" uuid NOT NULL,
	"prepared_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "pack_workspace_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "pack_status_check" CHECK ("decisions"."pack"."status" in ('draft', 'ready', 'decided')),
	CONSTRAINT "pack_name_check" CHECK (btrim("decisions"."pack"."name") <> '' and char_length("decisions"."pack"."name") <= 120)
);
--> statement-breakpoint
ALTER TABLE "decisions"."pack" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "decisions"."pack_member" (
	"workspace_id" uuid NOT NULL,
	"pack_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"backed_score" integer NOT NULL,
	"upper_bound" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "pack_member_pkey" PRIMARY KEY("workspace_id","pack_id","candidate_id"),
	CONSTRAINT "pack_member_position_key" UNIQUE("workspace_id","pack_id","position"),
	CONSTRAINT "pack_member_position_check" CHECK ("decisions"."pack_member"."position" >= 0),
	CONSTRAINT "pack_member_score_check" CHECK ("decisions"."pack_member"."backed_score" >= 0 and "decisions"."pack_member"."backed_score" <= "decisions"."pack_member"."upper_bound" and "decisions"."pack_member"."upper_bound" <= 100)
);
--> statement-breakpoint
ALTER TABLE "decisions"."pack_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "decisions"."decision" ADD CONSTRAINT "decision_member_fk" FOREIGN KEY ("workspace_id","pack_id","candidate_id") REFERENCES "decisions"."pack_member"("workspace_id","pack_id","candidate_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions"."pack_member" ADD CONSTRAINT "pack_member_pack_fk" FOREIGN KEY ("workspace_id","pack_id") REFERENCES "decisions"."pack"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_unsent_idx" ON "decisions"."outbox" USING btree ("next_attempt_at") WHERE "decisions"."outbox"."sent_at" is null;--> statement-breakpoint
CREATE POLICY "decision_tenant_isolation" ON "decisions"."decision" AS PERMISSIVE FOR ALL TO public USING ("decisions"."decision"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("decisions"."decision"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "outbox_tenant_isolation" ON "decisions"."outbox" AS PERMISSIVE FOR ALL TO public USING ("decisions"."outbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("decisions"."outbox"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "outbox_relay_read" ON "decisions"."outbox" AS PERMISSIVE FOR SELECT TO "aivera_relay" USING (true);--> statement-breakpoint
CREATE POLICY "outbox_relay_mark" ON "decisions"."outbox" AS PERMISSIVE FOR UPDATE TO "aivera_relay" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "pack_tenant_isolation" ON "decisions"."pack" AS PERMISSIVE FOR ALL TO public USING ("decisions"."pack"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("decisions"."pack"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "pack_member_tenant_isolation" ON "decisions"."pack_member" AS PERMISSIVE FOR ALL TO public USING ("decisions"."pack_member"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("decisions"."pack_member"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);