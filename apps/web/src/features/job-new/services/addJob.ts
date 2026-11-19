'use server';

import { log } from '@aivera/observability';
import { revalidatePath } from 'next/cache';
import { forbidden, unstable_rethrow } from 'next/navigation';
import { getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import { parseRubric } from '../domain/draft.ts';
import { formValues, parseNewJobForm, type NewJobState } from '../domain/jobNew.ts';
import { newJobOptions } from './newJobOptions.ts';

const offered = (list: { value: string }[], id: string | null) => !id || list.some((o) => o.value === id);

/**
 * "Save job and rubric" (AIV-P1-010): validates the job fields and the kept competencies (AGENTS.md 3.7), then, as an
 * admin or recruiter of the active workspace (`newJobOptions` authorises `job.create`; anyone else gets the 403 page),
 * saves the job at stage "defining rubric" with rubric version 1 as a draft, in one transaction. The workspace, the
 * creator and whether the job is synthetic come from the server, never from the form. Nothing is assessed from a draft.
 */
export async function addJob(_previous: NewJobState, form: FormData): Promise<NewJobState> {
  const parsed = parseNewJobForm(form);
  if ('state' in parsed) return parsed.state;
  const { input } = parsed;
  const failed: NewJobState = { errors: {}, error: 'failed', saved: false, values: formValues(form) };
  // The page blocks a save with a field to fix, so a rubric refused here was not sent by it.
  const competencies = parseRubric(form.get('rubric'));
  if (!competencies) return failed;
  let result;
  try {
    result = await inActiveWorkspace(async (ctx) => {
      const options = await newJobOptions(ctx);
      // Only an active hiring owner the page offered; the jobs module checks the client is the workspace's.
      if (!offered(options.hiringOwners, input.hiringOwnerUserId)) return null;
      return getJobs().createJobWithDraftRubric(ctx, { ...input, synthetic: options.synthetic, competencies });
    });
  } catch (error) {
    unstable_rethrow(error);
    // The name only: an error's detail can repeat what was typed (AGENTS.md 1.2).
    log.error({ area: 'job-new', 'error.type': error instanceof Error ? error.name : 'unknown' }, 'create failed');
    return failed;
  }
  if (!result) forbidden();
  if (!result.value) return failed;
  revalidatePath('/app/jobs');
  return { errors: {}, error: null, saved: true, values: failed.values };
}
