import type { ExplanationStatement } from '@credalent/assessment';
import type { NeedRow } from '@/features/evidence-profile/domain/needs.ts';

/** A decision pack page as the server hands it to the browser (AIV-P2-010): plain data, scores as snapshotted. */
export type PackPage = {
  jobId: string;
  packId: string;
  name: string;
  job: string;
  preparedAt: Date;
  /** The approved rubric version the pack is on, or null once the job's approved version has moved on. */
  rubricVersion: number | null;
  members: {
    candidateId: string;
    name: string | null;
    backedScore: number;
    upperBound: number;
    /** Who added the member and when; null on members added before this was stored, or once that account is gone. */
    added: { by: string; at: Date } | null;
  }[];
  /** The job's other applicants: they stay in the ranking and can be added to a later pack. */
  others: number;
};

/**
 * The pack as the hiring owner will see it (AIV-P1-116): summaries and sources only, never a contact detail, a CV or an
 * evidence file (AGENTS.md 1.9). `workspace` is the workspace's name, for the branded header.
 */
export type PackPreview = Pick<PackPage, 'name' | 'job' | 'preparedAt'> & {
  workspace: string;
  members: (Pick<PackPage['members'][number], 'candidateId' | 'name' | 'backedScore' | 'upperBound'> & {
    /**
     * From the assessment the member joined with: competencies that meet the job's need, those short of it, and the
     * cited explanation (AIV-P1-033). Null once a newer assessment replaced it, so nothing newer sits beside the pack's
     * scores.
     */
    summary: {
      strengths: NeedRow[];
      risks: NeedRow[];
      explanation: PreviewExplanation | null;
    } | null;
  })[];
};

/** Credalent's cited summary of one member in the preview. */
export type PreviewExplanation = { source: 'ai' | 'template'; statements: ExplanationStatement[] };

/** The pack page's states: loading.tsx and error.tsx render the first two. */
export type DecisionPackView =
  { status: 'loading' } | { status: 'error'; onRetry: () => void } | { status: 'ready'; pack: PackPage };

/** One undecided pack on the job's Decision tab. */
export type PackLink = { id: string; name: string; members: number };
