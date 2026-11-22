import type { JobHeader, RubricState } from '@credalent/jobs';

/** The five stages of a job, in order; each is a page under /app/jobs/[jobId] (AIV-P1-011). */
export const JOB_PAGES = ['description', 'rubric', 'candidates', 'interviews', 'pack'] as const;
export type JobPage = (typeof JOB_PAGES)[number];

export const parseJobPage = (segment: string | null): JobPage | null =>
  JOB_PAGES.find((page) => page === segment) ?? null;

export const jobPageHref = (jobId: string, page: JobPage) => `/app/jobs/${jobId}/${page}`;

/** A stage's status line as a `jobHeader.status` key and its values. */
export type StageLine =
  | { key: 'saved'; values: { date: Date } }
  | { key: 'approved' | 'draft' | 'awaiting_approval' | 'returned'; values: { version: number } }
  | { key: 'assessed'; values: { count: number } }
  | { key: 'afterApproval' | 'notStarted' };

/** The header as the layout hands it to the browser: plain data, only what it shows. */
export type JobHeaderView = {
  jobId: string;
  title: string;
  team: string | null;
  location: string | null;
  hiringOwner: string | null;
  assessed: number;
  rubric: RubricState;
  stages: { page: JobPage; line: StageLine; done: boolean }[];
};

export function jobHeaderView(
  { job, approved, latest }: JobHeader,
  hiringOwner: string | null,
  assessed: number,
): JobHeaderView {
  const lines: Record<JobPage, StageLine> = {
    // shortcut: a job is not edited after it is added yet, so "Saved" is when it was added; the job edit ticket adds
    // its own saved time.
    description: { key: 'saved', values: { date: job.createdAt } },
    rubric: approved
      ? { key: 'approved', values: { version: approved.version } }
      : latest && latest.status !== 'superseded'
        ? { key: latest.status, values: { version: latest.version } }
        : { key: 'notStarted' },
    // Nothing is assessed before the rubric is approved (by a recruiter, or the hiring owner it was sent to).
    candidates: !approved
      ? { key: 'afterApproval' }
      : assessed === 0
        ? { key: 'notStarted' }
        : { key: 'assessed', values: { count: assessed } },
    // shortcut: interviews (AIV-P2-001) and decision packs (AIV-P2-010) do not exist yet; they report these two.
    interviews: { key: 'notStarted' },
    pack: { key: 'notStarted' },
  };
  return {
    jobId: job.id,
    title: job.title,
    team: job.team,
    location: job.location,
    hiringOwner,
    assessed,
    rubric: { approved: approved !== null, latest: latest?.status ?? null },
    // Reached: the description always, the rubric once a version is approved.
    stages: JOB_PAGES.map((page) => ({
      page,
      line: lines[page],
      done: page === 'description' || (page === 'rubric' && approved !== null),
    })),
  };
}
