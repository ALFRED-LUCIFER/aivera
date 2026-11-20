CREATE TABLE "jobs"."catalogue_job_type" (
	"version" integer NOT NULL,
	"key" text NOT NULL,
	"position" integer NOT NULL,
	"label" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"starter_competencies" text[] NOT NULL,
	"retired" boolean DEFAULT false NOT NULL,
	CONSTRAINT "catalogue_job_type_pkey" PRIMARY KEY("version","key"),
	CONSTRAINT "catalogue_job_type_key_check" CHECK ("jobs"."catalogue_job_type"."key" ~ '^[a-z][a-z0-9_]{2,47}$' and "jobs"."catalogue_job_type"."key" not in ('none', 'several', 'other')),
	CONSTRAINT "catalogue_job_type_label_check" CHECK (coalesce(jsonb_typeof("jobs"."catalogue_job_type"."label"->'en') = 'string' and btrim("jobs"."catalogue_job_type"."label"->>'en') <> '', false) and coalesce(jsonb_typeof("jobs"."catalogue_job_type"."evidence"->'en') = 'string' and btrim("jobs"."catalogue_job_type"."evidence"->>'en') <> '', false)),
	CONSTRAINT "catalogue_job_type_starters_check" CHECK (cardinality("jobs"."catalogue_job_type"."starter_competencies") = 4)
);
--> statement-breakpoint
CREATE TABLE "jobs"."catalogue_pack" (
	"version" integer NOT NULL,
	"key" text NOT NULL,
	"position" integer NOT NULL,
	"label" jsonb NOT NULL,
	"retired" boolean DEFAULT false NOT NULL,
	CONSTRAINT "catalogue_pack_pkey" PRIMARY KEY("version","key"),
	CONSTRAINT "catalogue_pack_key_check" CHECK ("jobs"."catalogue_pack"."key" ~ '^[a-z][a-z0-9_]{2,47}$' and "jobs"."catalogue_pack"."key" not in ('none', 'several', 'other')),
	CONSTRAINT "catalogue_pack_label_check" CHECK (coalesce(jsonb_typeof("jobs"."catalogue_pack"."label"->'en') = 'string' and btrim("jobs"."catalogue_pack"."label"->>'en') <> '', false))
);
--> statement-breakpoint
CREATE TABLE "jobs"."catalogue_pack_competency" (
	"version" integer NOT NULL,
	"pack_key" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"meaning" text NOT NULL,
	"evidence" text NOT NULL,
	"level_1" text NOT NULL,
	"level_3" text NOT NULL,
	"level_5" text NOT NULL,
	"applies_to" text[] NOT NULL,
	"level_needed" integer NOT NULL,
	"type" text NOT NULL,
	"retired" boolean DEFAULT false NOT NULL,
	"core" text[] NOT NULL,
	CONSTRAINT "catalogue_pack_competency_pkey" PRIMARY KEY("version","pack_key","position"),
	CONSTRAINT "catalogue_pack_competency_text_check" CHECK (btrim("jobs"."catalogue_pack_competency"."name") <> '' and btrim("jobs"."catalogue_pack_competency"."meaning") <> '' and btrim("jobs"."catalogue_pack_competency"."evidence") <> ''),
	CONSTRAINT "catalogue_pack_competency_level_check" CHECK ("jobs"."catalogue_pack_competency"."level_needed" in (2, 3)),
	CONSTRAINT "catalogue_pack_competency_type_check" CHECK ("jobs"."catalogue_pack_competency"."type" = 'desirable'),
	CONSTRAINT "catalogue_pack_competency_core_check" CHECK ("jobs"."catalogue_pack_competency"."core" <@ "jobs"."catalogue_pack_competency"."applies_to")
);
--> statement-breakpoint
CREATE TABLE "jobs"."catalogue_region" (
	"version" integer NOT NULL,
	"key" text NOT NULL,
	"position" integer NOT NULL,
	"label" jsonb NOT NULL,
	"retired" boolean DEFAULT false NOT NULL,
	CONSTRAINT "catalogue_region_pkey" PRIMARY KEY("version","key"),
	CONSTRAINT "catalogue_region_key_check" CHECK ("jobs"."catalogue_region"."key" ~ '^[a-z][a-z0-9_]{2,47}$' and "jobs"."catalogue_region"."key" not in ('none', 'several', 'other')),
	CONSTRAINT "catalogue_region_label_check" CHECK (coalesce(jsonb_typeof("jobs"."catalogue_region"."label"->'en') = 'string' and btrim("jobs"."catalogue_region"."label"->>'en') <> '', false))
);
--> statement-breakpoint
CREATE TABLE "jobs"."catalogue_regional_hint" (
	"version" integer NOT NULL,
	"pack_key" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"meaning" text NOT NULL,
	"evidence" text NOT NULL,
	"level_1" text NOT NULL,
	"level_3" text NOT NULL,
	"level_5" text NOT NULL,
	"applies_to" text[] NOT NULL,
	"level_needed" integer NOT NULL,
	"type" text NOT NULL,
	"retired" boolean DEFAULT false NOT NULL,
	"region" text NOT NULL,
	CONSTRAINT "catalogue_regional_hint_pkey" PRIMARY KEY("version","pack_key","region","position"),
	CONSTRAINT "catalogue_regional_hint_text_check" CHECK (btrim("jobs"."catalogue_regional_hint"."name") <> '' and btrim("jobs"."catalogue_regional_hint"."meaning") <> '' and btrim("jobs"."catalogue_regional_hint"."evidence") <> ''),
	CONSTRAINT "catalogue_regional_hint_level_check" CHECK ("jobs"."catalogue_regional_hint"."level_needed" in (2, 3)),
	CONSTRAINT "catalogue_regional_hint_type_check" CHECK ("jobs"."catalogue_regional_hint"."type" = 'desirable')
);
--> statement-breakpoint
CREATE TABLE "jobs"."catalogue_version" (
	"version" integer PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"published_by" text,
	"published_at" timestamp with time zone,
	"reason" text,
	CONSTRAINT "catalogue_version_version_check" CHECK ("jobs"."catalogue_version"."version" >= 1),
	CONSTRAINT "catalogue_version_status_check" CHECK ("jobs"."catalogue_version"."status" in ('draft', 'published')),
	CONSTRAINT "catalogue_version_published_check" CHECK (("jobs"."catalogue_version"."status" = 'published') = ("jobs"."catalogue_version"."published_by" is not null and "jobs"."catalogue_version"."published_at" is not null and "jobs"."catalogue_version"."reason" is not null)),
	CONSTRAINT "catalogue_version_reason_check" CHECK (char_length(btrim("jobs"."catalogue_version"."reason")) >= 10),
	CONSTRAINT "catalogue_version_actor_check" CHECK (("jobs"."catalogue_version"."created_by" = 'system:seed' or "jobs"."catalogue_version"."created_by" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') and ("jobs"."catalogue_version"."published_by" is null or ("jobs"."catalogue_version"."published_by" = 'system:seed' or "jobs"."catalogue_version"."published_by" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')))
);
--> statement-breakpoint
ALTER TABLE "jobs"."competency" DROP CONSTRAINT "competency_pack_key_check";--> statement-breakpoint
ALTER TABLE "jobs"."job" DROP CONSTRAINT "job_type_check";--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_job_type" ADD CONSTRAINT "catalogue_job_type_version_catalogue_version_version_fk" FOREIGN KEY ("version") REFERENCES "jobs"."catalogue_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_pack" ADD CONSTRAINT "catalogue_pack_version_catalogue_version_version_fk" FOREIGN KEY ("version") REFERENCES "jobs"."catalogue_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_pack_competency" ADD CONSTRAINT "catalogue_pack_competency_version_catalogue_version_version_fk" FOREIGN KEY ("version") REFERENCES "jobs"."catalogue_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_pack_competency" ADD CONSTRAINT "catalogue_pack_competency_pack_fk" FOREIGN KEY ("version","pack_key") REFERENCES "jobs"."catalogue_pack"("version","key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_region" ADD CONSTRAINT "catalogue_region_version_catalogue_version_version_fk" FOREIGN KEY ("version") REFERENCES "jobs"."catalogue_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_regional_hint" ADD CONSTRAINT "catalogue_regional_hint_version_catalogue_version_version_fk" FOREIGN KEY ("version") REFERENCES "jobs"."catalogue_version"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_regional_hint" ADD CONSTRAINT "catalogue_regional_hint_pack_fk" FOREIGN KEY ("version","pack_key") REFERENCES "jobs"."catalogue_pack"("version","key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_regional_hint" ADD CONSTRAINT "catalogue_regional_hint_region_fk" FOREIGN KEY ("version","region") REFERENCES "jobs"."catalogue_region"("version","key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalogue_version_one_draft_idx" ON "jobs"."catalogue_version" USING btree ("status") WHERE "jobs"."catalogue_version"."status" = 'draft';--> statement-breakpoint
ALTER TABLE "jobs"."competency" ADD CONSTRAINT "competency_pack_format_check" CHECK ("jobs"."competency"."pack_key" ~ '^[a-z][a-z0-9_]{2,47}$' and "jobs"."competency"."pack_key" not in ('none', 'several', 'other') and "jobs"."competency"."pack_version" >= 1);--> statement-breakpoint
ALTER TABLE "jobs"."job" ADD CONSTRAINT "job_type_key_check" CHECK ("jobs"."job"."job_type" ~ '^[a-z][a-z0-9_]{2,47}$' and "jobs"."job"."job_type" not in ('none', 'several', 'other'));