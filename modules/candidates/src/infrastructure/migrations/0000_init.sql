CREATE SCHEMA "candidates";
--> statement-breakpoint
CREATE TABLE "candidates"."person" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"emails" text[] NOT NULL,
	"phones" text[] NOT NULL,
	"location" text,
	"synthetic" boolean NOT NULL,
	"merged_into_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidates"."person" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "candidates"."person_identifier" (
	"workspace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"person_id" uuid NOT NULL,
	CONSTRAINT "person_identifier_pkey" PRIMARY KEY("workspace_id","type","value"),
	CONSTRAINT "person_identifier_type_check" CHECK ("candidates"."person_identifier"."type" in ('email', 'phone', 'cv_hash', 'github_login'))
);
--> statement-breakpoint
ALTER TABLE "candidates"."person_identifier" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "candidates"."person_identifier" ADD CONSTRAINT "person_identifier_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "candidates"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_workspace_created_idx" ON "candidates"."person" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "person_identifier_person_idx" ON "candidates"."person_identifier" USING btree ("person_id");--> statement-breakpoint
CREATE POLICY "person_tenant_isolation" ON "candidates"."person" AS PERMISSIVE FOR ALL TO public USING ("candidates"."person"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("candidates"."person"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "person_identifier_tenant_isolation" ON "candidates"."person_identifier" AS PERMISSIVE FOR ALL TO public USING ("candidates"."person_identifier"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("candidates"."person_identifier"."workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);