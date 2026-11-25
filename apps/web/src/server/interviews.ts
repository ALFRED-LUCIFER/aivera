import type { InterviewsContract } from '@credalent/interviews';
import { createInterviews } from '@credalent/interviews/composition';
import { findApplication } from '@credalent/intake/composition';
import { getApprovedRubricReads, getJobs } from './jobs';
import { getWorkspaces } from './workspace';

let interviews: InterviewsContract | undefined;
/** The app's one interviews module instance; every call takes the request context from `inActiveWorkspace`. */
export const getInterviews = (): InterviewsContract =>
  (interviews ??= createInterviews(
    getWorkspaces(),
    getJobs(),
    getApprovedRubricReads().approvedRubric,
    findApplication,
  ));
