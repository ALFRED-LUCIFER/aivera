import { createAudit } from '@credalent/audit/composition';
import { displayNamesInWorkspace } from '@credalent/candidates/composition';
import type { IntakeContract } from '@credalent/intake';
import { createIntake } from '@credalent/intake/composition';
import { getCandidates } from './people';
import { getDb } from './db';
import { getJobs } from './jobs';
import { getWorkspaces } from './workspace';

let intake: IntakeContract | undefined;
/** The app's one intake module instance; every call takes the request context from `inActiveWorkspace`. */
export const getIntake = (): IntakeContract =>
  (intake ??= createIntake(getWorkspaces(), getCandidates(), getJobs(), displayNamesInWorkspace, createAudit(getDb())));
