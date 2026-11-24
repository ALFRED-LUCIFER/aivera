import { getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import type { PickerJob } from '../domain/importPage.ts';

/**
 * The picker's jobs (AIV-P1-101): the Jobs list's own read, so a hiring owner or interviewer would get their granted
 * jobs only (the page offers the picker to admins and recruiters). Id, title and rubric state only reach the browser.
 */
export async function loadImportJobs(): Promise<PickerJob[]> {
  const result = await inActiveWorkspace((ctx) => getJobs().listJobsForDesk(ctx));
  return (result?.value ?? []).map(({ id, title, rubric }) => ({ id, title, rubric }));
}
