CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE TABLE "audit"."entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"note" text,
	"before" jsonb,
	"after" jsonb,
	"correlation_id" uuid,
	CONSTRAINT "entry_actor_type_check" CHECK ("audit"."entry"."actor_type" in ('user', 'system', 'candidate', 'client')),
	CONSTRAINT "entry_actor_id_check" CHECK ("audit"."entry"."actor_type" = 'system' or "audit"."entry"."actor_id" is not null),
	CONSTRAINT "entry_action_check" CHECK ("audit"."entry"."action" in ('rubric.approved', 'score.changed', 'candidate.merged', 'decision.recorded', 'assistant.confirmed', 'member.role_changed')),
	CONSTRAINT "entry_note_check" CHECK ("audit"."entry"."action" not in ('score.changed', 'decision.recorded') or coalesce(btrim("audit"."entry"."note"), '') <> '')
);
--> statement-breakpoint
ALTER TABLE "audit"."entry" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "entry_subject_idx" ON "audit"."entry" USING btree ("workspace_id","subject_type","subject_id","occurred_at");--> statement-breakpoint
CREATE POLICY "entry_tenant_isolation" ON "audit"."entry" AS PERMISSIVE FOR ALL TO public USING ("audit"."entry"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("audit"."entry"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);