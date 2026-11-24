import type { AssessmentContract } from '@credalent/assessment';
import { createAssessment } from '@credalent/assessment/composition';
import { createAudit } from '@credalent/audit/composition';
import { readPersonAsSystem } from '@credalent/candidates/composition';
import { createApprovedRubricReads } from '@credalent/jobs/composition';
import { createApplicationReads, createCandidateJobResolver } from '@credalent/intake/composition';
import { aiOrUnavailable } from './ai';
import { getDb } from './db';
import { getEvidence } from './evidence';
import { getJobs } from './jobs';
import { getWorkspaces } from './workspace';

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
      evidence: (ctx, candidateId, jobId) => getEvidence().listEvidenceForCandidate(ctx, candidateId, jobId),
      identifiersOf: async (ctx, candidateId) => {
        const person = await readPersonAsSystem(ctx.tx, ctx.workspaceId, candidateId);
        // The intake placeholder is no name: redacting it would hide nothing. No person: no identifiers, the call fails closed.
        return person
          ? { names: person.unnamed ? [] : [person.displayName], emails: person.emails, phones: person.phones }
          : undefined;
      },
    },
  ));
