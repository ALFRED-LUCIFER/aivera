import { createAudit } from '@aivera/audit/composition';
import type { CompetencyDrafting, JobsContract } from '@aivera/jobs';
import { createCompetencyDrafting, createJobs } from '@aivera/jobs/composition';
import { getAi } from './ai';
import { getDb } from './db';
import { getWorkspaces } from './workspace';

let jobs: JobsContract | undefined;
/** The app's one jobs module instance; every call takes the request context from `inActiveWorkspace`. */
export const getJobs = (): JobsContract => (jobs ??= createJobs(getWorkspaces(), createAudit(getDb())));

let drafting: CompetencyDrafting | undefined;
/** "Draft competencies" (AIV-P1-008) on the app's AI client. */
export const getCompetencyDrafting = (): CompetencyDrafting => (drafting ??= createCompetencyDrafting(getAi()));
