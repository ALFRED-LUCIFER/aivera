import type { PublicJobsContract } from '@credalent/jobs';
import { createPublicJobs } from '@credalent/jobs/composition';
import { getDb } from './db';

let publicJobs: PublicJobsContract | undefined;
/** The candidate site's reads: no session, no workspace, as the aivera_public role (AIV-P3-002). */
export const getPublicJobs = (): PublicJobsContract => (publicJobs ??= createPublicJobs(getDb()));
