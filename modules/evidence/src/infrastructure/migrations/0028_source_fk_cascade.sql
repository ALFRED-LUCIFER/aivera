ALTER TABLE "evidence"."cv_parse" DROP CONSTRAINT "cv_parse_source_fk";
--> statement-breakpoint
ALTER TABLE "evidence"."document_read" DROP CONSTRAINT "document_read_source_fk";
--> statement-breakpoint
ALTER TABLE "evidence"."duplicate_flag" DROP CONSTRAINT "duplicate_flag_source_fk";
--> statement-breakpoint
ALTER TABLE "evidence"."duplicate_flag" DROP CONSTRAINT "duplicate_flag_other_source_fk";
--> statement-breakpoint
ALTER TABLE "evidence"."item" DROP CONSTRAINT "item_source_fk";
--> statement-breakpoint
ALTER TABLE "evidence"."link_read" DROP CONSTRAINT "link_read_source_fk";
--> statement-breakpoint
ALTER TABLE "evidence"."repository_read" DROP CONSTRAINT "repository_read_source_fk";
--> statement-breakpoint
ALTER TABLE "evidence"."source_note" DROP CONSTRAINT "source_note_source_fk";
--> statement-breakpoint
ALTER TABLE "evidence"."cv_parse" ADD CONSTRAINT "cv_parse_source_fk" FOREIGN KEY ("workspace_id","source_id","candidate_id") REFERENCES "evidence"."source"("workspace_id","id","candidate_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evidence"."document_read" ADD CONSTRAINT "document_read_source_fk" FOREIGN KEY ("workspace_id","source_id","candidate_id") REFERENCES "evidence"."source"("workspace_id","id","candidate_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evidence"."duplicate_flag" ADD CONSTRAINT "duplicate_flag_source_fk" FOREIGN KEY ("workspace_id","source_id","candidate_id") REFERENCES "evidence"."source"("workspace_id","id","candidate_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evidence"."duplicate_flag" ADD CONSTRAINT "duplicate_flag_other_source_fk" FOREIGN KEY ("workspace_id","other_source_id","other_candidate_id") REFERENCES "evidence"."source"("workspace_id","id","candidate_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evidence"."item" ADD CONSTRAINT "item_source_fk" FOREIGN KEY ("workspace_id","source_id","candidate_id") REFERENCES "evidence"."source"("workspace_id","id","candidate_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evidence"."link_read" ADD CONSTRAINT "link_read_source_fk" FOREIGN KEY ("workspace_id","source_id","candidate_id") REFERENCES "evidence"."source"("workspace_id","id","candidate_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evidence"."repository_read" ADD CONSTRAINT "repository_read_source_fk" FOREIGN KEY ("workspace_id","source_id","candidate_id") REFERENCES "evidence"."source"("workspace_id","id","candidate_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "evidence"."source_note" ADD CONSTRAINT "source_note_source_fk" FOREIGN KEY ("workspace_id","source_id","candidate_id") REFERENCES "evidence"."source"("workspace_id","id","candidate_id") ON DELETE no action ON UPDATE cascade;