'use server';

import { log } from '@credalent/observability';
import { revalidatePath } from 'next/cache';
import { forbidden, unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import { queueApprovalRequest } from './rubricEmails.ts';

/**
 * "Send rubric for approval" after Add a job, or "Send to the hiring owner" from the rubric page's approval panel
 * (AIV-P1-014, ADR-014): the draft goes to the hiring owner, with the approval email, in one transaction. It is the
 * recruiter's choice; they may still approve it themselves. The jobs module authorises `rubric.edit` (admins and
 * recruiters; anyone else gets the 403 page).
 */
export async function sendRubricForApproval(rubricVersionId: string): Promise<{ ok: boolean; emailed?: boolean }> {
  if (!z.uuid().safeParse(rubricVersionId).success) return { ok: false };
  let result;
  try {
    result = await inActiveWorkspace(async (ctx) => {
      let emailed = false;
      // The email is queued before the module's audit write, which stays last (AGENTS.md 3.6).
      await getJobs().submitRubric(ctx, rubricVersionId, async (sent) => {
        emailed = await queueApprovalRequest(ctx, sent);
      });
      return emailed;
    });
  } catch (error) {
    unstable_rethrow(error);
    log.error({ area: 'rubric', 'error.type': error instanceof Error ? error.name : 'unknown' }, 'send failed');
    return { ok: false };
  }
  if (!result) forbidden();
  revalidatePath('/app/jobs');
  return { ok: true, emailed: result.value };
}
