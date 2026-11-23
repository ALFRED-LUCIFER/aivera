ALTER TABLE "evidence"."comparison" DROP CONSTRAINT "comparison_resolution_check";--> statement-breakpoint
ALTER TABLE "evidence"."comparison" ADD COLUMN "resolution_standing_source_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence"."comparison" ADD CONSTRAINT "comparison_resolution_check" CHECK (("evidence"."comparison"."resolved_at" is null) = ("evidence"."comparison"."resolved_by" is null)
          and ("evidence"."comparison"."resolved_at" is null) = (coalesce(btrim("evidence"."comparison"."resolution_note"), '') = '')
          and ("evidence"."comparison"."resolved_at" is null) = (coalesce(btrim("evidence"."comparison"."resolution_limit"), '') = '')
          and ("evidence"."comparison"."resolved_at" is null or "evidence"."comparison"."outcome" = 'contradiction')
          and ("evidence"."comparison"."resolved_at" is not null or "evidence"."comparison"."resolution_standing_source_id" is null));