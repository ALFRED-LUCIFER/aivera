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
};

/**
 * `versions` newest first, as `listRubricVersions` returns them; `names` resolves approver ids. A superseded version
 * shows the change note of the approved version that replaced it ("Product judgement raised from 10% to 15%"), as the Rubric artboard
 * does; an approved version shows who approved it and when; any other shows its own note.
 */
export function rubricView(versions: Rubric[], names: ReadonlyMap<string, string>): RubricView {
  const shown = versions.find((v) => v.status === 'approved') ?? versions[0];
  return {
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

/** Scoring definitions, strongest first (DESIGN.md strength meter). */
export const STRENGTHS = ['strong', 'medium', 'supporting', 'claim'] as const;
