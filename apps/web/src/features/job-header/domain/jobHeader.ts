import type { JobHeader, RubricState } from '@credalent/jobs';
import type { OwnerChange } from './hiringOwner.ts';

/**
 * The stages of a job, in order; each is a page under /app/jobs/[jobId] (AIV-P1-011). "Bring in candidates" (AIV-P1-101)
 * is the first of AIV-P1-100's seven-stage strip to ship; that ticket renames and adds the rest.
 */
export const JOB_PAGES = ['description', 'rubric', 'import', 'candidates', 'interviews', 'pack'] as const;
export type JobPage = (typeof JOB_PAGES)[number];

/** The stage a route segment belongs to; a pack's own page (`packs/[packId]`, AIV-P2-010) is under the Decision stage. */
export const parseJobPage = (segment: string | null): JobPage | null =>
  segment === 'packs' ? 'pack' : (JOB_PAGES.find((page) => page === segment) ?? null);

export const jobPageHref = (jobId: string, page: JobPage) => `/app/jobs/${jobId}/${page}`;

/** A stage's status line as a `jobHeader.status` key and its values. */
export type StageLine =
  | { key: 'saved'; values: { date: Date } }
  | { key: 'approved' | 'draft' | 'awaiting_approval' | 'returned'; values: { version: number } }
  | { key: 'assessed' | 'imported'; values: { count: number } }
  | { key: 'afterApproval' | 'notStarted' | 'shortlistReady' };

/** The header as the layout hands it to the browser: plain data, only what it shows. */
export type JobHeaderView = {
  jobId: string;
  title: string;
  team: string | null;
  location: string | null;
  hiringOwner: string | null;
  /** The agency client the job is for; null in-house, and for a reader who may not list clients (AIV-P1-165). */
  client: string | null;
  assessed: number;
  /** The admin's hiring-owner picker; null for every other role (AIV-P1-097). */
  ownerChange: OwnerChange | null;
  rubric: RubricState;
  stages: { page: JobPage; line: StageLine; done: boolean }[];
};

export function jobHeaderView(
  { job, approved, latest }: JobHeader,
  hiringOwner: string | null,
  assessed: number,
  ownerChange: OwnerChange | null,
  /** The job's applications from every source, intake's count (AIV-P1-101). */
  imported: number,
  /** The job has an undecided decision pack (AIV-P2-011): "Shortlist ready". */
  shortlistReady: boolean,
  client: string | null = null,
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
    // People can be added before the rubric is approved; they are assessed once it is.
    import: imported === 0 ? { key: 'notStarted' } : { key: 'imported', values: { count: imported } },
    // Nothing is assessed before the rubric is approved (by a recruiter, or the hiring owner it was sent to).
    candidates: !approved
      ? { key: 'afterApproval' }
      : assessed === 0
        ? { key: 'notStarted' }
        : { key: 'assessed', values: { count: assessed } },
    // shortcut: the interviews (AIV-P2-002) report no stage line yet; their list ticket adds one here.
    interviews: { key: 'notStarted' },
    pack: shortlistReady ? { key: 'shortlistReady' } : { key: 'notStarted' },
  };
  return {
    jobId: job.id,
    title: job.title,
    team: job.team,
    location: job.location,
    hiringOwner,
    client,
    assessed,
    ownerChange,
    rubric: { approved: approved !== null, latest: latest?.status ?? null },
    // Reached: the description always, the rubric once a version is approved, and "Bring in candidates" and "Assess
    // evidence" once every application is assessed (AIV-P1-165 §7 "Job stages tick").
    stages: JOB_PAGES.map((page) => ({
      page,
      line: lines[page],
      done:
        page === 'description' ||
        (page === 'rubric' && approved !== null) ||
        ((page === 'import' || page === 'candidates') && approved !== null && imported > 0 && assessed >= imported),
    })),
  };
}
