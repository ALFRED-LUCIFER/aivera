import {
  DRAFT_COMPETENCIES_SYSTEM,
  DRAFT_COMPETENCIES_VERSION,
  draftCompetenciesPrompt,
  draftCompetenciesSchema,
  type AiClient,
  type Citation,
} from '@aivera/ai';
import type { JobType } from '../domain/job-types.ts';
import type { Competency } from '../domain/job.ts';

// "Draft competencies" (AIV-P1-008, ADR-006): the model drafts the competencies the job description states, each citing
// the description. A draft is a suggestion the recruiter keeps, edits or removes; nothing is saved here (AIV-P1-010).
// The prompt and schema are versioned in @aivera/ai, where the eval set runs them.

/** A drafted competency, as the rubric stores one, with the description spans it cites (offsets for `EvidenceHighlight`). */
export type DraftedCompetency = Omit<Competency, 'origin'> & { origin: 'from_description'; citations: Citation[] };

export type DraftInput = { jobType: JobType; title: string; description: string };

export type CompetencyDraft = {
  competencies: DraftedCompetency[];
  /** The description asked for something that is not a skill (a nationality, an age), and it was left out. */
  leftOutNonSkill: boolean;
};

/**
 * Drafts from the job type, title and description only: no candidate data and nothing else from the workspace reaches
 * the prompt. Throws `@aivera/ai`'s errors: `BudgetExceeded`, `AiUnavailable`, or, when the answer fails its schema or
 * cites nothing twice, `SchemaMismatch`, `UncitedOutput` or `InvalidCitation`.
 */
export function competencyDrafting(ai: Pick<AiClient, 'generateStructured'>) {
  return {
    async draftCompetencies(workspaceId: string, input: DraftInput): Promise<CompetencyDraft> {
      const { competencies, refused } = await ai.generateStructured({
        task: 'jobs.draftCompetencies',
        workspaceId,
        promptVersion: DRAFT_COMPETENCIES_VERSION,
        system: DRAFT_COMPETENCIES_SYSTEM,
        prompt: draftCompetenciesPrompt(input),
        schema: draftCompetenciesSchema,
        sources: [{ id: 'description', kind: 'job_description', text: input.description }],
      });
      return {
        competencies: competencies.map((c) => ({
          name: c.name,
          evidenceExpected: c.evidenceExpected,
          weightPercent: c.weight,
          levelNeeded: c.level,
          type: c.type,
          origin: 'from_description',
          citations: c.citations,
        })),
        leftOutNonSkill: refused,
      };
    },
  };
}
