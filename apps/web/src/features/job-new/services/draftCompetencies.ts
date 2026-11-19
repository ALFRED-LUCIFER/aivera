'use server';

import { BudgetExceeded } from '@aivera/ai';
import { log } from '@aivera/observability';
import { forbidden, unstable_rethrow } from 'next/navigation';
import { getCompetencyDrafting } from '@/server/jobs';
import { getWorkspaces, inActiveWorkspace } from '@/server/workspace';
import { toDraftCompetency, type DraftResult } from '../domain/draft.ts';
import { parseNewJobForm } from '../domain/jobNew.ts';

/**
 * "Draft competencies" (AIV-P1-008): validates step 1 (AGENTS.md 3.7) and, for an admin or recruiter of the active
 * workspace (`job.create`; anyone else gets the 403 page), drafts competencies from the job type, title and description.
 * Saves nothing: the draft is a suggestion the recruiter keeps, edits or removes.
 */
export async function draftCompetencies(form: FormData): Promise<DraftResult> {
  const parsed = parseNewJobForm(form);
  if ('state' in parsed)
    return parsed.state.error ? { status: 'failed' } : { status: 'invalid', errors: parsed.state.errors };
  const { jobType, title, description } = parsed.input;
  try {
    // Authorised in its own short transaction: the model call (up to a minute) must not hold a database connection.
    const allowed = await inActiveWorkspace(async (ctx) => {
      await getWorkspaces().authorize(ctx, 'job.create');
      return ctx.workspaceId;
    });
    if (!allowed) forbidden();
    if (!description) return { status: 'empty' };
    const draft = await getCompetencyDrafting().draftCompetencies(allowed.value, { jobType, title, description });
    return {
      status: 'drafted',
      competencies: draft.competencies.map((c) => toDraftCompetency(description, c)),
      leftOutNonSkill: draft.leftOutNonSkill,
    };
  } catch (error) {
    unstable_rethrow(error);
    // The name only: the AI errors carry no prompt or output, but any error's detail could repeat the description.
    log.warn({ area: 'job-new', 'error.type': error instanceof Error ? error.name : 'unknown' }, 'draft failed');
    return { status: error instanceof BudgetExceeded ? 'budget' : 'failed' };
  }
}
