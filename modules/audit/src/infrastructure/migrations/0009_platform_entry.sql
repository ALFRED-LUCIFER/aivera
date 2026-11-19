CREATE TABLE "audit"."platform_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"subject_type" text,
	"subject_id" uuid,
	"note" text,
	CONSTRAINT "platform_entry_action_check" CHECK ("audit"."platform_entry"."action" in ('ops.console_opened')),
	CONSTRAINT "platform_entry_subject_check" CHECK (("audit"."platform_entry"."subject_type" is null) = ("audit"."platform_entry"."subject_id" is null))
);
