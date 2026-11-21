ALTER TABLE "jobs"."catalogue_eval_run" DROP CONSTRAINT "catalogue_eval_run_version_catalogue_version_version_fk";
--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_eval_run" ALTER COLUMN "version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_eval_run" ADD CONSTRAINT "catalogue_eval_run_version_catalogue_version_version_fk" FOREIGN KEY ("version") REFERENCES "jobs"."catalogue_version"("version") ON DELETE set null ON UPDATE no action;