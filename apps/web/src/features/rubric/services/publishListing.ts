'use server';

import { JobError, PUBLIC_DESCRIPTOR_MAX } from '@credalent/jobs';
import { log } from '@credalent/observability';
import { revalidatePath } from 'next/cache';
import { forbidden, unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import type { PublishResult } from '../domain/rubric.ts';

const input = z.object({
  jobId: z.uuid(),
  // Present to publish, absent to unpublish; the jobs module trims it and checks it does not name the client.
  publicDescriptor: z.string().max(PUBLIC_DESCRIPTOR_MAX).optional(),
});

/**
 * "Publish" in the preview and "Unpublish" (AIV-P1-015), each in one transaction with its audit entry and its
 * JobPublished.v1 or JobUnpublished.v1 event. The jobs module authorises `job.publish` (admins and recruiters; anyone
 * else gets the 403 page) and needs an approved rubric to publish.
 */
export async function publishListing(raw: z.input<typeof input>): Promise<PublishResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { error: 'failed' };
  const { jobId, publicDescriptor } = parsed.data;
  let result;
  try {
    result = await inActiveWorkspace((ctx) =>
      publicDescriptor === undefined
        ? getJobs().unpublishJob(ctx, jobId)
        : getJobs().publishJob(ctx, jobId, { publicDescriptor }),
    );
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof JobError && error.code === 'public_descriptor') return { error: 'descriptor' };
    // The name and code only: an error's detail can repeat what was typed (AGENTS.md 1.2).
    log.error(
      {
        area: 'rubric',
        'error.type': error instanceof Error ? error.name : 'unknown',
        'error.code': error instanceof JobError ? error.code : undefined,
      },
      'publish failed',
    );
    return { error: 'failed' };
  }
  if (!result) forbidden();
  revalidatePath(`/app/jobs/${jobId}`, 'layout');
  return { ok: true };
}
