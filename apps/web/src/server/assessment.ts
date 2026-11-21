import type { AssessmentContract } from '@credalent/assessment';
import { createAssessment } from '@credalent/assessment/composition';
import { createAudit } from '@credalent/audit/composition';
import { getDb } from './db';
import { getJobs } from './jobs';
import { getWorkspaces } from './workspace';

let assessment: AssessmentContract | undefined;
/** The app's one assessment module instance (AIV-P1-034 reads the ranking); every call takes the request context. */
export const getAssessment = (): AssessmentContract =>
  (assessment ??= createAssessment(getWorkspaces(), createAudit(getDb()), getJobs()));
