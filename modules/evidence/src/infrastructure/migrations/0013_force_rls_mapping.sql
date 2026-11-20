-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-005).
ALTER TABLE "evidence"."mapping" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evidence"."evidence_gap" FORCE ROW LEVEL SECURITY;
