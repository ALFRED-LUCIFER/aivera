ALTER TABLE "jobs"."rubric_version" ADD COLUMN "submitted_by" uuid;--> statement-breakpoint
ALTER TABLE "jobs"."rubric_version" ADD COLUMN "return_note" text;--> statement-breakpoint
ALTER TABLE "jobs"."rubric_version" ADD CONSTRAINT "rubric_version_return_note_check" CHECK (char_length("jobs"."rubric_version"."return_note") between 1 and 1000);