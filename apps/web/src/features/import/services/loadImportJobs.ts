import { getJobs } from '@/server/jobs';
import { getWorkspaces, inActiveWorkspace } from '@/server/workspace';
import type { PickerJob } from '../domain/importPage.ts';

/**
 * The picker's jobs (AIV-P1-101): the Jobs list's own read, so a hiring owner or interviewer would get their granted
 * jobs only (the page offers the picker to admins and recruiters). Id, title and rubric state only reach the browser.
 * `agency`: the intro's line about a client having already seen someone is an agency's alone (AIV-P1-165).
 */
export async function loadImportJobs(): Promise<{ jobs: PickerJob[]; agency: boolean }> {
  const result = await inActiveWorkspace(async (ctx) => ({
    jobs: await getJobs().listJobsForDesk(ctx),
    agency: (await getWorkspaces().getWorkspace(ctx))?.type === 'agency',
  }));
  const { jobs = [], agency = false } = result?.value ?? {};
  return { jobs: jobs.map(({ id, title, rubric }) => ({ id, title, rubric })), agency };
}
