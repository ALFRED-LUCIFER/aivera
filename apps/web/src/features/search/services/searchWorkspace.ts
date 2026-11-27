'use server';

import { log } from '@credalent/observability';
import { unstable_rethrow } from 'next/navigation';
import { profileHref } from '@/features/evidence-profile/domain/profile.ts';
import { getIntake } from '@/server/intake';
import { getJobs } from '@/server/jobs';
import { inActiveWorkspace } from '@/server/workspace';
import { searchResults, searchSchema, type SearchResults } from '../domain/search.ts';

/**
 * The top-bar search (AIV-P1-049): the jobs this member can see by title, and their applicants by name. Only the
 * active workspace is read, through contracts that apply its row-level security and the member's job scope (ADR-005),
 * so another workspace's "Sara" is never returned. The query arrives in the action's body, never a URL, and is not
 * logged: the log line carries counts and error names only (AGENTS.md 1.2). Null with no workspace or a refused read.
 */
export async function searchWorkspace(input: unknown): Promise<SearchResults | null> {
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) return { jobs: [], candidates: [] };
  try {
    const result = await inActiveWorkspace(async (ctx) => {
      const jobs = [];
      // shortcut: one applicant read per job, in memory; a name index in intake when a workspace passes ~50 open jobs.
      for (const job of await getJobs().listJobs(ctx))
        jobs.push({ id: job.id, title: job.title, applicants: await getIntake().listApplicationsForJob(ctx, job.id) });
      return jobs;
    });
    if (!result) return null;
    const results = searchResults(parsed.data.query, result.value, {
      job: (jobId) => `/app/jobs/${jobId}`,
      person: profileHref,
    });
    log.info(
      {
        area: 'search',
        'credalent.search.jobs': results.jobs.length,
        'credalent.search.candidates': results.candidates.length,
      },
      'workspace searched',
    );
    return results;
  } catch (error) {
    unstable_rethrow(error);
    log.error({ area: 'search', 'error.type': error instanceof Error ? error.name : 'unknown' }, 'search failed');
    return null;
  }
}
