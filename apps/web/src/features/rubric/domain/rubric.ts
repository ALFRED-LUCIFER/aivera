import type { Competency, Rubric, RubricStatus } from '@credalent/jobs';
import { z } from 'zod';

/** One line of the approval history: who approved and when, or the change that made the next version. */
type HistoryEntry = {
  version: number;
  status: RubricStatus;
  /** `by` is null when the approver's name cannot be read. */
  approved: { by: string | null; at: Date } | null;
  note: string | null;
  /** The hiring owner's note when they returned it (AIV-P1-014), until it is sent again. */
  returnNote: string | null;
};

/** The version awaiting the hiring owner's approval (AIV-P1-014), with what changed since the approved one. */
export type ReviewView = {
  versionId: string;
  revision: number;
  version: number;
  changeNote: string | null;
  /** The version in force that this one would supersede; null when none is approved yet. */
  approvedVersion: number | null;
  successStatement: string;
  competencies: Competency[];
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
  /** The version awaiting approval, or null when none is. */
  review: ReviewView | null;
  /** The open draft or returned version, which an admin or recruiter may approve directly (ADR-014), or null. */
  approvable: ReviewView | null;
  /** How many competencies the approved version has: what the candidate site lists (AIV-P1-015). */
  approvedCompetencies: number;
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

/** The approval panel as the rubric component shows it: the decision controller's view model and handlers (AIV-P1-014). */
export type RubricDecisionView = {
  returning: boolean;
  note: string;
  pending: boolean;
  status: 'idle' | 'approved' | 'returned' | 'stale' | 'failed';
  /** The version the last decision was about, and whether an approved one stays in force, for its message after the
   * page reloads without it. */
  decided: { version: number; inForce: boolean } | null;
  onApprove: () => void;
  onStartReturn: () => void;
  onCancelReturn: () => void;
  onNote: (value: string) => void;
  onReturn: () => void;
};

/** What a decision returns to the page. */
export type DecisionResult = { ok: true } | { error: 'stale' | 'failed' };

/**
 * The approver reads the version awaiting approval, the one they decide on, in place of the approved one (AIV-P1-014).
 * `link` is the version and revision the approval email pointed to: when another copy awaits now, the link is outdated.
 */
export function approverView(view: RubricView, link: { versionId: string; revision: number } | null) {
  const { review } = view;
  return {
    rubric: review
      ? {
          ...view,
          shown: {
            version: review.version,
            successStatement: review.successStatement,
            competencies: review.competencies,
          },
        }
      : view,
    outdatedLink: Boolean(review && link && (link.versionId !== review.versionId || link.revision !== review.revision)),
  };
}

const linkSchema = z.object({ version: z.uuid(), revision: z.coerce.number().int().min(0) });

/** The version and revision an approval email links to (`?version=<id>&revision=<n>`); null when absent or malformed. */
export function reviewLink(params: Record<string, string | string[] | undefined>) {
  const parsed = linkSchema.safeParse(params);
  return parsed.success ? { versionId: parsed.data.version, revision: parsed.data.revision } : null;
}

/** The approval email's link to the version awaiting approval: opaque ids only (AGENTS.md 1.2). */
export const reviewPath = (jobId: string, review: { versionId: string; revision: number }) =>
  `/app/jobs/${jobId}/rubric?version=${review.versionId}&revision=${review.revision}`;

/** The rubric page's Publish panel (AIV-P1-015): whether the job is listed, and what publishing needs. */
export type PublicationView = {
  published: boolean;
  /** Publishing needs an approved rubric. */
  approved: boolean;
  /** The candidate site's slug while published, for "View public listing". */
  slug: string | null;
  /** How the candidate site names the employer, from the last time it was published. */
  descriptor: string | null;
  /** How many competencies candidates see. */
  competencies: number;
};

/** The Publish panel's controller: the preview, the descriptor typed in it, and the outcome (AIV-P1-015). */
export type PublishView = {
  previewing: boolean;
  descriptor: string;
  pending: boolean;
  status: 'idle' | 'published' | 'unpublished' | 'descriptor' | 'failed';
  onPreview: () => void;
  onCancel: () => void;
  onDescriptor: (value: string) => void;
  /** Rejects when nothing was published, so the preview shows why. */
  onPublish: () => Promise<void>;
  onUnpublish: () => void;
  /** After Cancel, focus returns to "Publish this job" rather than dropping to the page. */
  returnFocus: boolean;
};

export type PublishResult = { ok: true } | { error: 'descriptor' | 'failed' };

/** The candidate site's page for a published job. */
export const publicListingPath = (slug: string) => `/candidates/jobs/${slug}`;

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
  const reviewOf = (v: Rubric): ReviewView => ({
    versionId: v.id,
    revision: v.revision,
    version: v.version,
    changeNote: v.changeNote,
    approvedVersion: approved?.version ?? null,
    successStatement: v.successStatement,
    competencies: v.competencies,
  });
  return {
    approvedCompetencies: approved?.competencies.length ?? 0,
    review: open?.status === 'awaiting_approval' ? reviewOf(open) : null,
    approvable: open && open.status !== 'awaiting_approval' ? reviewOf(open) : null,
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
      returnNote: v.returnNote,
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
