import { createAudit } from '@credalent/audit/composition';
import type { DecisionsContract } from '@credalent/decisions';
import { createDecisions } from '@credalent/decisions/composition';
import { getAssessment } from './assessment';
import { getDb } from './db';
import { getJobs } from './jobs';
import { getWorkspaces } from './workspace';

let decisions: DecisionsContract | undefined;
/** The app's one decisions module instance (AIV-P2-010); every call takes the request context from `inActiveWorkspace`. */
export const getDecisions = (): DecisionsContract =>
  (decisions ??= createDecisions(getWorkspaces(), getJobs(), getAssessment(), createAudit(getDb())));
