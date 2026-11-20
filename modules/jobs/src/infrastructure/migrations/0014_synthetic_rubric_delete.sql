-- Custom migration (drizzle-kit generate --custom): the demo seed's reset deletes a synthetic job's approved or
-- superseded rubric versions and their competencies (AIV-P1-067). A real job's stay undeletable; a job row hidden by
-- row-level security counts as real. The version function is 0011's, with DELETE allowed for synthetic jobs only.
CREATE OR REPLACE FUNCTION "jobs"."refuse_approved_version_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "jobs"."job" WHERE id = OLD.job_id AND synthetic))
      OR (TG_OP = 'UPDATE' AND ((NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'approved' AND NEW.status = 'superseded'))
      OR (OLD.success_statement, OLD.change_note, OLD.version, OLD.job_id, OLD.workspace_id,
      OLD.created_by, OLD.created_at, OLD.approved_by, OLD.approved_at, OLD.revision, OLD.submitted_by,
      OLD.return_note) IS DISTINCT FROM (NEW.success_statement, NEW.change_note, NEW.version, NEW.job_id,
      NEW.workspace_id, NEW.created_by, NEW.created_at, NEW.approved_by, NEW.approved_at, NEW.revision,
      NEW.submitted_by, NEW.return_note))) THEN
    RAISE EXCEPTION 'An approved rubric version cannot change.' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'rubric_version_frozen_check';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
--> statement-breakpoint
-- 0001's competency function, with DELETE allowed when the version belongs to a synthetic job.
CREATE OR REPLACE FUNCTION "jobs"."refuse_approved_competency_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "jobs"."rubric_version" v
      WHERE v.id IN (OLD.rubric_version_id, NEW.rubric_version_id) AND v.status IN ('approved', 'superseded')
      AND NOT (TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM "jobs"."job" j WHERE j.id = v.job_id AND j.synthetic))) THEN
    RAISE EXCEPTION 'An approved rubric version cannot change.' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'competency_version_frozen_check';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
