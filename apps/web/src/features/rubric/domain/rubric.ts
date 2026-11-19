import type { Competency, Rubric, RubricStatus } from '@aivera/jobs';

/** One line of the approval history: who approved and when, or the change that made the next version. */
type HistoryEntry = {
  version: number;
  status: RubricStatus;
  /** `by` is null when the approver's name cannot be read. */
  approved: { by: string | null; at: Date } | null;
  note: string | null;
};

/** The rubric page as the server hands it to the browser: plain data, only what it shows. */
export type RubricView = {
  /** The version in force, or the latest when none is approved yet; null when the job has no rubric. */
  shown: { version: number; successStatement: string; competencies: Competency[] } | null;
  history: HistoryEntry[];
  /**
   * What "Edit rubric" opens (AIV-P1-013): the open version, so a second editor resumes it, or else the approved one;
   * null when there is neither. `base` goes back with the save, which is refused if the version moved on since.
   */
  edit: { base: RubricBase; successStatement: string; competencies: Competency[] } | null;
};

export type RubricBase = { versionId: string; revision: number };

/** Edit mode as the rubric component shows it: the controller's view model and handlers (AIV-P1-013). */
export type RubricEditorView = {
  editing: boolean;
  competencies: Competency[];
  successStatement: string;
  total: number;
  canSave: boolean;
  pending: boolean;
  status: 'idle' | 'saved' | 'sent' | 'stale' | 'failed';
  onStart: () => void;
  onCancel: () => void;
  onChange: (index: number, patch: Partial<Competency>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onSuccessStatement: (value: string) => void;
  onSave: () => void;
  onSend: () => void;
};

/** What saving a draft returns to the page: the saved version as the next base, or why it was not saved. */
export type SaveResult = { base: RubricBase } | { error: 'stale' | 'failed' };

/**
 * `versions` newest first, as `listRubricVersions` returns them; `names` resolves approver ids. A superseded version
 * shows the change note of the approved version that replaced it ("Product judgement raised from 10% to 15%"), as the
 * Rubric artboard does; an approved version shows who approved it and when; any other shows its own note.
 */
export function rubricView(versions: Rubric[], names: ReadonlyMap<string, string>): RubricView {
  const approved = versions.find((v) => v.status === 'approved');
  const shown = approved ?? versions[0];
  const open = versions.find(
    (v) => v.status === 'draft' || v.status === 'awaiting_approval' || v.status === 'returned',
  );
  const editable = open ?? approved;
  return {
    edit: editable
      ? {
          base: { versionId: editable.id, revision: editable.revision },
          successStatement: editable.successStatement,
          competencies: editable.competencies,
        }
      : null,
    shown: shown
      ? { version: shown.version, successStatement: shown.successStatement, competencies: shown.competencies }
      : null,
    history: versions.map((v, i) => ({
      version: v.version,
      status: v.status,
      approved:
        v.status === 'approved' && v.approvedBy && v.approvedAt
          ? { by: names.get(v.approvedBy) || null, at: v.approvedAt }
          : null,
      // An approved version's own note is shown under the version it superseded.
      note:
        v.status === 'superseded'
          ? (versions.slice(0, i).findLast((n) => n.status === 'approved' || n.status === 'superseded')?.changeNote ??
            null)
          : v.status === 'approved'
            ? null
            : v.changeNote,
    })),
  };
}

export const weightsTotal = (competencies: readonly Pick<Competency, 'weightPercent'>[]) =>
  competencies.reduce((sum, c) => sum + c.weightPercent, 0);

/** A competency the recruiter adds in edit mode: mandatory at level 3 until they set it. */
export const newCompetency = (): Competency => ({
  name: '',
  evidenceExpected: '',
  weightPercent: 0,
  levelNeeded: 3,
  type: 'mandatory',
  origin: 'added_by_recruiter',
});

/** Send and save need weights totalling 100, each from 1 to 100, and every competency named (the jobs module checks both again). */
export const canSave = (competencies: readonly Competency[]) =>
  competencies.length > 0 &&
  weightsTotal(competencies) === 100 &&
  competencies.every((c) => c.name.trim() !== '' && c.weightPercent >= 1 && c.weightPercent <= 100);

/** Scoring definitions, strongest first (DESIGN.md strength meter). */
export const STRENGTHS = ['strong', 'medium', 'supporting', 'claim'] as const;
