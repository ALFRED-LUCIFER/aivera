import { selectGaps } from '@credalent/assessment';
import { createAudit } from '@credalent/audit/composition';
import { displayNamesInWorkspace } from '@credalent/candidates/composition';
import type { IntakeContract } from '@credalent/intake';
import { createIntake } from '@credalent/intake/composition';
import { getAssessment } from './assessment';
import { getCandidates } from './people';
import { getDb } from './db';
import { getInterviews } from './interviews';
import { getApprovedRubricReads, getJobs } from './jobs';
import { getWorkspaces } from './workspace';

let intake: IntakeContract | undefined;
/** The app's one intake module instance; every call takes the request context from `inActiveWorkspace`. */
export const getIntake = (): IntakeContract =>
  (intake ??= createIntake(
    getWorkspaces(),
    getCandidates(),
    getJobs(),
    displayNamesInWorkspace,
    createAudit(getDb()),
    undefined,
    // Choosing for interview (AIV-P1-114). Each call authorises the member itself; called lazily, so the modules build
    // in any order.
    {
      createInterview: (ctx, input) => getInterviews().createInterview(ctx, input),
      async interviewGaps(ctx, personId, jobId) {
        const latest = await getAssessment().getLatestAssessment(ctx, personId, jobId);
        if (!latest) return [];
        // A result on an older rubric version may name competencies the approved one no longer has.
        const rubric = await getApprovedRubricReads().approvedRubric(ctx.tx, ctx.workspaceId, jobId);
        const approved = new Set(rubric?.competencies.map((c) => c.id));
        return selectGaps(latest)
          .map((gap) => gap.competencyId)
          .filter((id) => approved.has(id));
      },
    },
  ));
