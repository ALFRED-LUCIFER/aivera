ALTER TABLE "jobs"."competency" DROP CONSTRAINT "competency_origin_check";--> statement-breakpoint
ALTER TABLE "jobs"."competency" ADD COLUMN "pack_key" text;--> statement-breakpoint
ALTER TABLE "jobs"."competency" ADD COLUMN "pack_version" integer;--> statement-breakpoint
ALTER TABLE "jobs"."competency" ADD CONSTRAINT "competency_domain_pack_check" CHECK (("jobs"."competency"."origin" = 'domain_pack') = ("jobs"."competency"."pack_key" is not null and "jobs"."competency"."pack_version" is not null));--> statement-breakpoint
ALTER TABLE "jobs"."competency" ADD CONSTRAINT "competency_origin_check" CHECK ("jobs"."competency"."origin" in ('from_description', 'suggested_by_aivera', 'added_by_recruiter', 'domain_pack'));