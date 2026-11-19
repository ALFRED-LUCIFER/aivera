'use server';

import { log } from '@aivera/observability';
import { revalidatePath } from 'next/cache';
import { forbidden, redirect, unstable_rethrow } from 'next/navigation';
import { getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import { formValues, parseNewJobForm, type NewJobState } from '../domain/jobNew.ts';
import { newJobOptions } from './newJobOptions.ts';

const JOBS = '/app/jobs';
const offered = (list: { value: string }[], id: string | null) => !id || list.some((o) => o.value === id);

/**
 * "Save job": validates step 1 (AGENTS.md 3.7), then, as an admin or recruiter of the active workspace
 * (`newJobOptions` authorises `job.create`; anyone else gets the 403 page), saves the job at stage "defining rubric".
 * The workspace, the creator and whether the job is synthetic come from the server, never from the form.
 * shortcut: "Save job" saves the job alone; the drafted competencies on the page are not saved with it until
 * "Save job and rubric" (AIV-P1-010) replaces this action. A resubmit after going back saves a second job.
 */
export async function addJob(_previous: NewJobState, form: FormData): Promise<NewJobState> {
  const parsed = parseNewJobForm(form);
  if ('state' in parsed) return parsed.state;
  const { input } = parsed;
  const failed: NewJobState = { errors: {}, error: 'failed', values: formValues(form) };
  let result;
  try {
    result = await inActiveWorkspace(async (ctx) => {
      const options = await newJobOptions(ctx);
      // Only an active hiring owner the page offered; createJob itself checks the client is the workspace's.
      if (!offered(options.hiringOwners, input.hiringOwnerUserId)) return null;
      return getJobs().createJob(ctx, { ...input, synthetic: options.synthetic });
    });
  } catch (error) {
    unstable_rethrow(error);
    // The name only: an error's detail can repeat what was typed (AGENTS.md 1.2).
    log.error({ area: 'job-new', 'error.type': error instanceof Error ? error.name : 'unknown' }, 'create failed');
    return failed;
  }
  if (!result) forbidden();
  if (!result.value) return failed;
  revalidatePath(JOBS);
  redirect(JOBS);
}
