import type { AssessmentContract } from '@credalent/assessment';
import { createAssessment } from '@credalent/assessment/composition';
import { createAudit } from '@credalent/audit/composition';
import { readPersonAsSystem } from '@credalent/candidates/composition';
import { createApprovedRubricReads } from '@credalent/jobs/composition';
import { createApplicationReads, createCandidateJobResolver } from '@credalent/intake/composition';
import type { WorkspaceContext } from '@credalent/workspaces';
import { aiOrUnavailable } from './ai';
import { getDb } from './db';
import { getEvidence } from './evidence';
import { getCatalogue, getJobs } from './jobs';
import { getWorkspaces } from './workspace';

const evidenceOf = (ctx: WorkspaceContext, candidateId: string, jobId: string) =>
  getEvidence().listEvidenceForCandidate(ctx, candidateId, jobId);

// The person's identifiers the AI client replaces in every source (ADR-006 point 7).
const identifiersOf = async (ctx: WorkspaceContext, candidateId: string) => {
  const person = await readPersonAsSystem(ctx.tx, ctx.workspaceId, candidateId);
  // The intake placeholder is no name: redacting it would hide nothing. No person: no identifiers, the call fails closed.
  return person
    ? { names: person.unnamed ? [] : [person.displayName], emails: person.emails, phones: person.phones }
    : undefined;
};

let assessment: AssessmentContract | undefined;
/** The app's one assessment module instance (AIV-P1-034 reads the ranking); every call takes the request context. */
export const getAssessment = (): AssessmentContract =>
  (assessment ??= createAssessment(
    getWorkspaces(),
    createAudit(getDb()),
    getJobs(),
    undefined,
    createCandidateJobResolver(getJobs()),
    createApplicationReads().candidatesForJob,
    {
      // Lazy: building the module must not need AI configuration (an unconfigured app still lists rankings).
      ai: aiOrUnavailable('assessment.explainRanking'),
      approvedRubric: createApprovedRubricReads().approvedRubric,
      evidence: evidenceOf,
      identifiersOf,
    },
    // Interview-based score changes (AIV-P1-117) are wired by the first screen that calls them (AIV-P2-004, AIV-P1-115).
    undefined,
    // Suggested interview questions (AIV-P1-113), lazy as the explanation is: an unconfigured app answers "failed".
    {
      ai: aiOrUnavailable('assessment.suggestQuestions'),
      approvedRubric: createApprovedRubricReads().approvedRubric,
      evidence: evidenceOf,
      identifiersOf,
      changes: async (ctx, candidateId, jobId) =>
        (await getEvidence().getEvidenceMapping(ctx, candidateId, jobId))?.changes ?? [],
      jobOf: async (ctx, jobId) => {
        const job = await getJobs().getJob(ctx, jobId);
        if (!job) return null;
        // A rubric's pack competencies name their domain pack; the published catalogue has its name.
        const key = (await getJobs().getApprovedRubric(ctx, jobId))?.competencies.find((c) => c.packKey)?.packKey;
        const pack = key ? (await getCatalogue().getPublishedCatalogue()).packs.find((p) => p.key === key) : undefined;
        return { title: job.title, domainPack: pack?.label.en ?? null };
      },
    },
  ));
