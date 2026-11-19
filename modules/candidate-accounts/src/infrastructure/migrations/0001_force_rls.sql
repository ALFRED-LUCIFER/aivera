-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-009).
ALTER TABLE "candidate_accounts"."account" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "candidate_accounts"."profile" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "candidate_accounts"."consent" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "candidate_accounts"."workspace_link" FORCE ROW LEVEL SECURITY;
