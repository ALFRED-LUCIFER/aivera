'use server';

import { COMPETENCY_ORIGINS, COMPETENCY_TYPES, DOMAIN_KEYS, JobError } from '@aivera/jobs';
import { log } from '@aivera/observability';
import { revalidatePath } from 'next/cache';
import { forbidden, unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import type { SaveResult } from '../domain/rubric.ts';

const input = z.object({
  jobId: z.uuid(),
  base: z.object({ versionId: z.uuid(), revision: z.int().min(0) }),
  successStatement: z.string().max(2000),
  competencies: z
    .array(
      z.object({
        name: z.string().max(200),
        evidenceExpected: z.string().max(1000),
        weightPercent: z.int(),
        levelNeeded: z.int(),
        type: z.enum(COMPETENCY_TYPES),
        origin: z.enum(COMPETENCY_ORIGINS),
        packKey: z.enum(DOMAIN_KEYS).nullable().default(null),
        packVersion: z.int().nullable().default(null),
      }),
    )
    .max(30),
  submit: z.boolean(),
});

/**
 * "Save draft" and "Send changes for approval" (AIV-P1-013), in one transaction. The jobs module authorises
 * `rubric.edit` (admins and recruiters; anyone else gets the 403 page), saves the open version or starts the next one,
 * and refuses a save from an older copy (`stale`) without changing anything. The approved version stays in force.
 */
export async function saveRubricDraft(raw: z.input<typeof input>): Promise<SaveResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { error: 'failed' };
  const { jobId, base, successStatement, competencies, submit } = parsed.data;
  let result;
  try {
    result = await inActiveWorkspace(async (ctx) => {
      const version = await getJobs().saveRubric(ctx, jobId, { successStatement, competencies, base });
      if (submit) await getJobs().submitRubric(ctx, version.id);
      return version;
    });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof JobError && error.code === 'stale') return { error: 'stale' };
    // The name and code only: an error's detail can repeat what was typed (AGENTS.md 1.2).
    log.error(
      {
        area: 'rubric',
        'error.type': error instanceof Error ? error.name : 'unknown',
        'error.code': (error as JobError).code,
      },
      'save failed',
    );
    return { error: 'failed' };
  }
  if (!result) forbidden();
  revalidatePath(`/app/jobs/${jobId}`, 'layout');
  return { base: { versionId: result.value.id, revision: result.value.revision } };
}
