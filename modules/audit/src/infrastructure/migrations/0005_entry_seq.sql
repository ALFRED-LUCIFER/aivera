-- AIV-P0-925: insertion order breaks ties between entries from one clock reading. ADD COLUMN rewrites the table and
-- numbers existing rows in heap order, close to insertion order here (existing same-instant ties were random before); no UPDATE runs, so the
-- append-only triggers are untouched, and occurred_at still orders every row with a distinct time as before.
DROP INDEX "audit"."entry_subject_idx";--> statement-breakpoint
ALTER TABLE "audit"."entry" ADD COLUMN "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "audit"."entry_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
CREATE INDEX "entry_subject_idx" ON "audit"."entry" USING btree ("workspace_id","subject_type","subject_id","occurred_at","seq");
