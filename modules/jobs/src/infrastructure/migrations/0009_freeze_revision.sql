-- Custom migration (drizzle-kit generate --custom): an approved or superseded version's revision is frozen too, since
-- it is the concurrency token an editor's save is checked against (AIV-P1-013). Same function as 0001, plus revision.
CREATE OR REPLACE FUNCTION "jobs"."refuse_approved_version_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'approved' AND NEW.status = 'superseded'))
      OR (OLD.success_statement, OLD.change_note, OLD.version, OLD.job_id, OLD.workspace_id,
      OLD.created_by, OLD.created_at, OLD.approved_by, OLD.approved_at, OLD.revision) IS DISTINCT FROM (NEW.success_statement,
      NEW.change_note, NEW.version, NEW.job_id, NEW.workspace_id, NEW.created_by, NEW.created_at, NEW.approved_by,
      NEW.approved_at, NEW.revision) THEN
    RAISE EXCEPTION 'An approved rubric version cannot change.' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'rubric_version_frozen_check';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
