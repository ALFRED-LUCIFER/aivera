'use server';

import { z } from 'zod';
import { getJobs } from '@/server/jobs';
import { workspaceAction } from '@/server/workspace';
import { copiedCompetency, type DraftCompetency } from '../domain/draft.ts';

// "Duplicate an earlier job or rubric" (AIV-P1-165). Admins and recruiters of the active workspace (`job.create`;
// anyone else gets the 403 page), and only a job that workspace holds and the caller may view: the jobs module refuses
// any other id as not found, under row-level security. Reads the rubric's competencies and nothing else of the job: no
// candidate, note, score or decision is read here, so none can be copied. Saves nothing.
const copy = workspaceAction(
  'job.create',
  async (ctx, jobId): Promise<DraftCompetency[] | null> => {
    const versions = await getJobs().listRubricVersions(ctx, jobId);
    // The rubric in force when one is approved, else the latest version (newest first).
    const source = versions?.find((v) => v.status === 'approved') ?? versions?.[0];
    return source ? source.competencies.map(copiedCompetency) : null;
  },
  { input: z.uuid() },
);

/** The competencies of that job's rubric as rows for a new draft; null when the job or its rubric is not found. */
export async function duplicateRubric(jobId: string): Promise<DraftCompetency[] | null> {
  return copy(jobId);
}
