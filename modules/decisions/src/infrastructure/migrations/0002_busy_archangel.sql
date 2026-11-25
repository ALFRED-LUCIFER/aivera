ALTER TABLE "decisions"."pack_member" ADD COLUMN "added_by" uuid;--> statement-breakpoint
ALTER TABLE "decisions"."pack_member" ADD COLUMN "added_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "decisions"."pack_member" ADD CONSTRAINT "pack_member_added_check" CHECK (("decisions"."pack_member"."added_by" is null) = ("decisions"."pack_member"."added_at" is null));