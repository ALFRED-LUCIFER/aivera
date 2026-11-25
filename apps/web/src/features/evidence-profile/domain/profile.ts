import type { ExplanationStatement, RankingRow } from '@credalent/assessment';
import type { Stage } from '@credalent/intake';
import type { EvidenceCard, SourceNoteView } from './evidenceCards.ts';
import type { NeedRow } from './needs.ts';

/** The profile's address: opaque ids only (AGENTS.md 1.2). The job is required: a profile is always for one job. */
export const profileHref = (candidateId: string, jobId: string) => `/app/candidates/${candidateId}?job=${jobId}`;

/** The element id of a cited item on its evidence card, which a cited phrase in "Why they are ranked here" scrolls to. */
export const evidenceAnchor = (itemId: string) => `evidence-${itemId}`;

/** How the candidate fits the job: nothing is assessed before a rubric is approved, and not everyone is scored yet. */
export type Fit =
  | { status: 'awaiting_rubric' }
  | { status: 'not_scored' }
  | ({ status: 'scored' } & Pick<
      RankingRow,
      'rank' | 'backedScore' | 'upperBound' | 'meetsNeed' | 'competencyCount'
    > & {
        /** How many candidates the job's ranking lists: "rank 1 of N". */
        ranked: number;
        /** Competencies whose claimed level is above the proven one: "if their two open claims hold". */
        openClaims: number;
      });

/** The top of the candidate evidence profile (AIV-P1-043) as the page hands it to the browser: plain data. */
export type ProfileData = {
  jobId: string;
  jobTitle: string;
  /** Null only if the person record is gone. */
  name: string | null;
  stage: Stage;
  fit: Fit;
  /** "Why they are ranked here" (AIV-P1-033); null when there is no result on the approved rubric version. */
  explanation: { source: 'ai' | 'template'; statements: ExplanationStatement[] } | null;
  /** "Competency by competency" (AIV-P1-045), heaviest first; empty with no result on the approved rubric version. */
  competencies: EvidenceCard[];
  /** "Against what the job needs" (AIV-P1-044), in the cards' order; empty with no result on the approved version. */
  needs: NeedRow[];
  /** "Unusual content in this source" notes on the candidate's sources; admins and recruiters only. */
  notes: SourceNoteView[];
};
