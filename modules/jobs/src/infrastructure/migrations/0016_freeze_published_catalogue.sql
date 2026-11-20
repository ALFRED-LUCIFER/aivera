-- Custom migration (drizzle-kit generate --custom): a published catalogue version never changes (ADR-013 point 4).
-- Triggers fire for every role, the table owner included, and ENABLE ALWAYS keeps them on under session_replication_role
-- = replica, as the audit log's do; changing a published entry means publishing a new version.
-- TRUNCATE skips row triggers, so it is refused outright: a draft is discarded with DELETE.
-- shortcut: INSERT into a published version is not refused, so the version 1 seed can rerun with ON CONFLICT DO NOTHING;
-- refuse it too once publish stores a content hash to compare against (AIV-P2-048, AIV-P2-049).
CREATE FUNCTION "jobs"."refuse_published_catalogue_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' OR EXISTS (SELECT 1 FROM "jobs"."catalogue_version"
      WHERE version IN (OLD.version, NEW.version) AND status = 'published') THEN
    RAISE EXCEPTION 'A published catalogue version cannot change.' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'catalogue_version_frozen_check';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER "catalogue_version_frozen_check" BEFORE UPDATE OR DELETE ON "jobs"."catalogue_version"
  FOR EACH ROW EXECUTE FUNCTION "jobs"."refuse_published_catalogue_change"();
--> statement-breakpoint
CREATE TRIGGER "catalogue_job_type_frozen_check" BEFORE UPDATE OR DELETE ON "jobs"."catalogue_job_type"
  FOR EACH ROW EXECUTE FUNCTION "jobs"."refuse_published_catalogue_change"();
--> statement-breakpoint
CREATE TRIGGER "catalogue_region_frozen_check" BEFORE UPDATE OR DELETE ON "jobs"."catalogue_region"
  FOR EACH ROW EXECUTE FUNCTION "jobs"."refuse_published_catalogue_change"();
--> statement-breakpoint
CREATE TRIGGER "catalogue_pack_frozen_check" BEFORE UPDATE OR DELETE ON "jobs"."catalogue_pack"
  FOR EACH ROW EXECUTE FUNCTION "jobs"."refuse_published_catalogue_change"();
--> statement-breakpoint
CREATE TRIGGER "catalogue_pack_competency_frozen_check" BEFORE UPDATE OR DELETE ON "jobs"."catalogue_pack_competency"
  FOR EACH ROW EXECUTE FUNCTION "jobs"."refuse_published_catalogue_change"();
--> statement-breakpoint
CREATE TRIGGER "catalogue_regional_hint_frozen_check" BEFORE UPDATE OR DELETE ON "jobs"."catalogue_regional_hint"
  FOR EACH ROW EXECUTE FUNCTION "jobs"."refuse_published_catalogue_change"();
--> statement-breakpoint
CREATE TRIGGER "catalogue_version_no_truncate" BEFORE TRUNCATE ON "jobs"."catalogue_version"
  FOR EACH STATEMENT EXECUTE FUNCTION "jobs"."refuse_published_catalogue_change"();
--> statement-breakpoint
CREATE TRIGGER "catalogue_job_type_no_truncate" BEFORE TRUNCATE ON "jobs"."catalogue_job_type"
  FOR EACH STATEMENT EXECUTE FUNCTION "jobs"."refuse_published_catalogue_change"();
--> statement-breakpoint
CREATE TRIGGER "catalogue_region_no_truncate" BEFORE TRUNCATE ON "jobs"."catalogue_region"
  FOR EACH STATEMENT EXECUTE FUNCTION "jobs"."refuse_published_catalogue_change"();
--> statement-breakpoint
CREATE TRIGGER "catalogue_pack_no_truncate" BEFORE TRUNCATE ON "jobs"."catalogue_pack"
  FOR EACH STATEMENT EXECUTE FUNCTION "jobs"."refuse_published_catalogue_change"();
--> statement-breakpoint
CREATE TRIGGER "catalogue_pack_competency_no_truncate" BEFORE TRUNCATE ON "jobs"."catalogue_pack_competency"
  FOR EACH STATEMENT EXECUTE FUNCTION "jobs"."refuse_published_catalogue_change"();
--> statement-breakpoint
CREATE TRIGGER "catalogue_regional_hint_no_truncate" BEFORE TRUNCATE ON "jobs"."catalogue_regional_hint"
  FOR EACH STATEMENT EXECUTE FUNCTION "jobs"."refuse_published_catalogue_change"();
--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_version" ENABLE ALWAYS TRIGGER "catalogue_version_frozen_check";
--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_version" ENABLE ALWAYS TRIGGER "catalogue_version_no_truncate";
--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_job_type" ENABLE ALWAYS TRIGGER "catalogue_job_type_frozen_check";
--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_job_type" ENABLE ALWAYS TRIGGER "catalogue_job_type_no_truncate";
--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_region" ENABLE ALWAYS TRIGGER "catalogue_region_frozen_check";
--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_region" ENABLE ALWAYS TRIGGER "catalogue_region_no_truncate";
--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_pack" ENABLE ALWAYS TRIGGER "catalogue_pack_frozen_check";
--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_pack" ENABLE ALWAYS TRIGGER "catalogue_pack_no_truncate";
--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_pack_competency" ENABLE ALWAYS TRIGGER "catalogue_pack_competency_frozen_check";
--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_pack_competency" ENABLE ALWAYS TRIGGER "catalogue_pack_competency_no_truncate";
--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_regional_hint" ENABLE ALWAYS TRIGGER "catalogue_regional_hint_frozen_check";
--> statement-breakpoint
ALTER TABLE "jobs"."catalogue_regional_hint" ENABLE ALWAYS TRIGGER "catalogue_regional_hint_no_truncate";
