import { createAudit } from '@aivera/audit/composition';
import type { JobsContract } from '@aivera/jobs';
import { createJobs } from '@aivera/jobs/composition';
import { getDb } from './db';
import { getWorkspaces } from './workspace';

let jobs: JobsContract | undefined;
/** The app's one jobs module instance; every call takes the request context from `inActiveWorkspace`. */
export const getJobs = (): JobsContract => (jobs ??= createJobs(getWorkspaces(), createAudit(getDb())));
