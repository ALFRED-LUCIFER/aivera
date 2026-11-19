CREATE SCHEMA "ops";
--> statement-breakpoint
CREATE TABLE "ops"."platform_setting" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"approval_required" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_setting_single_row" CHECK ("ops"."platform_setting"."id")
);
