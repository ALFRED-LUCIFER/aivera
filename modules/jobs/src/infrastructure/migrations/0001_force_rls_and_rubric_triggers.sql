-- Custom migration (drizzle-kit generate --custom): Drizzle emits ENABLE but not FORCE row-level security (ADR-005),
-- and cannot express the rubric rules that span rows (AGENTS.md 3.5).
ALTER TABLE "jobs"."job" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "jobs"."rubric_version" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "jobs"."competency" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A version's competency weights total 100, checked at commit so a draft can be replaced row by row in one transaction.
CREATE FUNCTION "jobs"."check_competency_weights"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  total bigint;
BEGIN
  SELECT sum(weight_percent) INTO total FROM "jobs"."competency"
    WHERE rubric_version_id = coalesce(NEW.rubric_version_id, OLD.rubric_version_id);
  IF total IS NOT NULL AND total <> 100 THEN
    RAISE EXCEPTION 'Weights must total 100%%.' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'competency_weights_total_check';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "competency_weights_total_check" AFTER INSERT OR UPDATE OR DELETE ON "jobs"."competency"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "jobs"."check_competency_weights"();
--> statement-breakpoint
-- An approved or superseded version is what assessment ran against: its competencies never change.
CREATE FUNCTION "jobs"."refuse_approved_competency_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "jobs"."rubric_version"
      WHERE id IN (OLD.rubric_version_id, NEW.rubric_version_id) AND status IN ('approved', 'superseded')) THEN
    RAISE EXCEPTION 'An approved rubric version cannot change.' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'competency_version_frozen_check';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER "competency_version_frozen_check" BEFORE INSERT OR UPDATE OR DELETE ON "jobs"."competency"
  FOR EACH ROW EXECUTE FUNCTION "jobs"."refuse_approved_competency_change"();
--> statement-breakpoint
-- An approved version's content is frozen too; only its status moves on (approved -> superseded).
CREATE FUNCTION "jobs"."refuse_approved_version_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (OLD.success_statement, OLD.change_note, OLD.version, OLD.job_id, OLD.workspace_id,
      OLD.created_by, OLD.created_at, OLD.approved_by, OLD.approved_at) IS DISTINCT FROM (NEW.success_statement,
      NEW.change_note, NEW.version, NEW.job_id, NEW.workspace_id, NEW.created_by, NEW.created_at, NEW.approved_by,
      NEW.approved_at) THEN
    RAISE EXCEPTION 'An approved rubric version cannot change.' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'rubric_version_frozen_check';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER "rubric_version_frozen_check" BEFORE UPDATE OR DELETE ON "jobs"."rubric_version"
  FOR EACH ROW WHEN (OLD.status IN ('approved', 'superseded'))
  EXECUTE FUNCTION "jobs"."refuse_approved_version_change"();
