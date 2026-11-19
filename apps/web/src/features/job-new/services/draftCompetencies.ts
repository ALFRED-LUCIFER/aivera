'use server';

import { AiUnavailable, BudgetExceeded } from '@aivera/ai';
import { log } from '@aivera/observability';
import { forbidden, unstable_rethrow } from 'next/navigation';
import { getCompetencyDrafting, getDomainDetection } from '@/server/jobs';
import { getWorkspaces, inActiveWorkspace } from '@/server/workspace';
import { toDetectedIndustry, toDraftCompetency, type DraftResult } from '../domain/draft.ts';
import { parseNewJobForm } from '../domain/jobNew.ts';

/**
 * "Draft competencies" (AIV-P1-008): validates step 1 (AGENTS.md 3.7) and, for an admin or recruiter of the active
 * workspace (`job.create`; anyone else gets the 403 page), drafts competencies from the job type, title and description,
 * then the suggestions for what it leaves out (AIV-P1-009), and beside them detects the hiring company's industry and the
 * job's regions (AIV-P1-063, AIV-P1-064). Saves nothing: the recruiter keeps, edits or removes each.
 */
export async function draftCompetencies(form: FormData): Promise<DraftResult> {
  const parsed = parseNewJobForm(form);
  if ('state' in parsed)
    return parsed.state.error ? { status: 'failed' } : { status: 'invalid', errors: parsed.state.errors };
  const { jobType, title, description, location } = parsed.input;
  try {
    // Authorised in its own short transaction: the model call (up to a minute) must not hold a database connection.
    const allowed = await inActiveWorkspace(async (ctx) => {
      await getWorkspaces().authorize(ctx, 'job.create');
      return ctx.workspaceId;
    });
    if (!allowed) forbidden();
    if (!description) return { status: 'empty' };
    const [draft, detection] = await Promise.all([
      getCompetencyDrafting().draftCompetencies(allowed.value, { jobType, title, description }),
      getDomainDetection()
        .detectDomain(allowed.value, { jobType, title, description, location })
        .catch((error: unknown) => {
          if (!(error instanceof AiUnavailable || error instanceof BudgetExceeded)) throw error;
          // An outage or the budget is no industry: the recruiter can still choose one with "Add industry skills".
          log.warn({ area: 'job-new', 'error.type': error instanceof Error ? error.name : 'unknown' }, 'detect failed');
          return null;
        }),
    ]);
    return {
      status: 'drafted',
      competencies: [...draft.competencies, ...draft.suggestions].map((c) => toDraftCompetency(description, c)),
      leftOutNonSkill: draft.leftOutNonSkill,
      jobType,
      ...toDetectedIndustry(description, detection),
    };
  } catch (error) {
    unstable_rethrow(error);
    // The name only: the AI errors carry no prompt or output, but any error's detail could repeat the description.
    log.warn({ area: 'job-new', 'error.type': error instanceof Error ? error.name : 'unknown' }, 'draft failed');
    return { status: error instanceof BudgetExceeded ? 'budget' : 'failed' };
  }
}
