import type { ExplanationStatement, RankingRow } from '@credalent/assessment';
import type { Stage } from '@credalent/intake';

/** The profile's address: opaque ids only (AGENTS.md 1.2). The job is required: a profile is always for one job. */
export const profileHref = (candidateId: string, jobId: string) => `/app/candidates/${candidateId}?job=${jobId}`;

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
};
