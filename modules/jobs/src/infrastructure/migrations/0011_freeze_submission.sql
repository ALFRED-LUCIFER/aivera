-- Custom migration (drizzle-kit generate --custom): who sent an approved or superseded version and the note it was
-- returned with are frozen too (AIV-P1-014). Same function as 0009, plus submitted_by and return_note.
CREATE OR REPLACE FUNCTION "jobs"."refuse_approved_version_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'approved' AND NEW.status = 'superseded'))
      OR (OLD.success_statement, OLD.change_note, OLD.version, OLD.job_id, OLD.workspace_id,
      OLD.created_by, OLD.created_at, OLD.approved_by, OLD.approved_at, OLD.revision, OLD.submitted_by,
      OLD.return_note) IS DISTINCT FROM (NEW.success_statement, NEW.change_note, NEW.version, NEW.job_id,
      NEW.workspace_id, NEW.created_by, NEW.created_at, NEW.approved_by, NEW.approved_at, NEW.revision,
      NEW.submitted_by, NEW.return_note) THEN
    RAISE EXCEPTION 'An approved rubric version cannot change.' USING ERRCODE = 'check_violation',
      CONSTRAINT = 'rubric_version_frozen_check';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
