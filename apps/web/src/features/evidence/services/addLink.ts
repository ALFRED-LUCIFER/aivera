'use server';

import { parseRepositoryUrl } from '@credalent/evidence';
import { log } from '@credalent/observability';
import { forbidden, unstable_rethrow } from 'next/navigation';
import { getIntake } from '@/server/intake';
import { inActiveWorkspace } from '@/server/workspace';
import { addLinkSchema, type AddLinkResult } from '../domain/addLink.ts';

/**
 * A member adds a work link on a candidate's application (AIV-P1-076). The intake module checks the application's job
 * (admins and recruiters; hiring owners and interviewers only on a job they are granted; anyone else gets the 403
 * page), keeps the link on the application, and evidence reads it when it is a GitHub repository. Nothing about the
 * link reaches a log (AGENTS.md 1.2).
 */
export async function addLink(input: unknown): Promise<AddLinkResult> {
  const parsed = addLinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'failed' };
  const { applicationId, url } = parsed.data;
  try {
    const result = await inActiveWorkspace((ctx) => getIntake().addLink(ctx, applicationId, url));
    if (!result) forbidden();
  } catch (error) {
    unstable_rethrow(error);
    log.error({ area: 'evidence', 'error.type': error instanceof Error ? error.name : 'unknown' }, 'add link failed');
    return { ok: false, error: 'failed' };
  }
  // shortcut: an application with no confirmed batch (from before AIV-P1-104) stores the link but the worker never reads it; the ticket that wires the add-link UI must not report `read: true` for it (refuse, or say to add their CV again to confirm).
  return parseRepositoryUrl(url)
    ? { ok: true, read: true }
    : { ok: true, read: false, message: 'repositoryStatus.plainLink' };
}
