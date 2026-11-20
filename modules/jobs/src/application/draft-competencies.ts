import { draftCompetenciesRequest, type AiClient, type Citation } from '@credalent/ai';
import { offeredJobTypes, type CatalogueVersion } from '../domain/catalogue.ts';
import { JobError, newSuggestions, type Competency } from '../domain/job.ts';

// "Draft competencies" (AIV-P1-008, ADR-006): the model drafts the competencies the job description states, and
// suggests up to two it leaves out (AIV-P1-009), each citing the description. Both are suggestions the recruiter keeps,
// edits or removes; nothing is saved here (AIV-P1-010). The prompt and schema are versioned in @credalent/ai, where the
// eval set runs them.

/** A drafted competency, as the rubric stores one, with the description spans it cites (offsets for `EvidenceHighlight`). */
export type DraftedCompetency = Omit<Competency, 'origin'> & { origin: 'from_description'; citations: Citation[] };

/** A competency the description leaves out, with "Why:" it is suggested and the description line that implies it. */
export type SuggestedCompetency = Omit<Competency, 'origin'> & {
  origin: 'suggested_by_aivera';
  why: string;
  citations: Citation[];
};

export type DraftInput = { jobType: string; title: string; description: string };

export type CompetencyDraft = {
  competencies: DraftedCompetency[];
  /** At most two, none named like a drafted competency. */
  suggestions: SuggestedCompetency[];
  /** The description asked for something that is not a skill (a nationality, an age), and it was left out. */
  leftOutNonSkill: boolean;
};

type Answered = Pick<Competency, 'name' | 'evidenceExpected' | 'type'> & {
  weight: number;
  level: number;
  citations: Citation[];
};
const fields = (c: Answered) => ({
  name: c.name,
  evidenceExpected: c.evidenceExpected,
  weightPercent: c.weight,
  levelNeeded: c.level,
  type: c.type,
  citations: c.citations,
});

/**
 * Drafts from the job type, title and description only: no candidate data and nothing else from the workspace reaches
 * the prompt. The job type must be one `catalogue` (the published version) offers, else `JobError('job_type')` before any
 * model call. Throws `@credalent/ai`'s errors: `BudgetExceeded`, `AiUnavailable`, or, when the answer fails its schema or
 * cites nothing twice, `SchemaMismatch`, `UncitedOutput` or `InvalidCitation`.
 */
export function competencyDrafting(ai: Pick<AiClient, 'generateStructured'>) {
  return {
    async draftCompetencies(
      workspaceId: string,
      input: DraftInput,
      catalogue: CatalogueVersion,
    ): Promise<CompetencyDraft> {
      if (!offeredJobTypes(catalogue).some((t) => t.key === input.jobType)) throw new JobError('job_type');
      const { competencies, suggestions, refused } = await ai.generateStructured({
        ...draftCompetenciesRequest(input, [{ id: 'description', kind: 'job_description', text: input.description }]),
        catalogueVersion: catalogue.version,
        workspaceId,
      });
      return {
        competencies: competencies.map((c) => ({ ...fields(c), origin: 'from_description' })),
        suggestions: newSuggestions(competencies, suggestions).map((s) => ({
          ...fields(s),
          origin: 'suggested_by_aivera',
          why: s.why,
        })),
        leftOutNonSkill: refused,
      };
    },
  };
}
