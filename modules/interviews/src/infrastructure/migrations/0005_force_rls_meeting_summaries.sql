-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-005).
ALTER TABLE "interviews"."meeting_summaries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "interviews"."summary_proposals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "interviews"."inbox" FORCE ROW LEVEL SECURITY;
