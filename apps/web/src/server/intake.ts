import { createAudit } from '@credalent/audit/composition';
import { displayNamesInWorkspace } from '@credalent/candidates/composition';
import type { IntakeContract } from '@credalent/intake';
import { createIntake } from '@credalent/intake/composition';
import { getAssessment } from './assessment';
import { getCandidates } from './people';
import { getDb } from './db';
import { getInterviews } from './interviews';
import { getJobs } from './jobs';
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
    () => new Date(),
    // Choosing for interview (AIV-P1-114). Each call authorises the member itself; called lazily, so the modules build
    // in any order.
    {
      createInterview: (ctx, input) => getInterviews().createInterview(ctx, input),
      interviewGaps: (ctx, personId, jobId) => getAssessment().interviewGaps(ctx, personId, jobId),
    },
  ));
