ALTER TABLE "audit"."entry" DROP CONSTRAINT "entry_actor_type_check";--> statement-breakpoint
ALTER TABLE "audit"."entry" DROP CONSTRAINT "entry_action_check";--> statement-breakpoint
ALTER TABLE "audit"."entry" DROP CONSTRAINT "entry_note_check";--> statement-breakpoint
ALTER TABLE "audit"."platform_entry" DROP CONSTRAINT "platform_entry_action_check";--> statement-breakpoint
ALTER TABLE "audit"."platform_entry" ADD COLUMN "before" jsonb;--> statement-breakpoint
ALTER TABLE "audit"."platform_entry" ADD COLUMN "after" jsonb;--> statement-breakpoint
ALTER TABLE "audit"."entry" ADD CONSTRAINT "entry_actor_type_check" CHECK ("audit"."entry"."actor_type" in ('user', 'system', 'candidate', 'client', 'operator'));--> statement-breakpoint
ALTER TABLE "audit"."entry" ADD CONSTRAINT "entry_action_check" CHECK ("audit"."entry"."action" in ('rubric.approved', 'score.changed', 'candidate.merged', 'decision.recorded', 'assistant.confirmed', 'member.role_changed', 'workspace.created', 'workspace.type_changed', 'client.added', 'client.renamed', 'client.archived', 'job_access.granted', 'job_access.revoked', 'job.created', 'member.added', 'workspace.purged', 'job.published', 'job.unpublished', 'ai_budget.changed'));--> statement-breakpoint
ALTER TABLE "audit"."entry" ADD CONSTRAINT "entry_note_check" CHECK ("audit"."entry"."action" not in ('score.changed', 'decision.recorded', 'ai_budget.changed') or coalesce(btrim("audit"."entry"."note"), '') <> '');--> statement-breakpoint
ALTER TABLE "audit"."platform_entry" ADD CONSTRAINT "platform_entry_note_check" CHECK ("audit"."platform_entry"."action" <> 'ai_budget.changed' or coalesce(btrim("audit"."platform_entry"."note"), '') <> '');--> statement-breakpoint
ALTER TABLE "audit"."platform_entry" ADD CONSTRAINT "platform_entry_action_check" CHECK ("audit"."platform_entry"."action" in ('ops.console_opened', 'ops.workspace_viewed', 'ai_budget.changed'));