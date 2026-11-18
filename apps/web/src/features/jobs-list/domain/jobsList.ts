import type { DeskJob, RubricState } from '@aivera/jobs';

/** A Jobs list row as the page hands it to the browser: plain data, only what the table shows. */
export type JobRow = Pick<
  DeskJob,
  'id' | 'title' | 'team' | 'location' | 'stage' | 'rubric' | 'assessed' | 'coveragePercent' | 'nextAction'
> & { hiringOwner: string | null };

export const toJobRow = (job: DeskJob, hiringOwner: string | null): JobRow => ({
  id: job.id,
  title: job.title,
  team: job.team,
  location: job.location,
  stage: job.stage,
  rubric: job.rubric,
  assessed: job.assessed,
  coveragePercent: job.coveragePercent,
  nextAction: job.nextAction,
  hiringOwner,
});

export const JOB_FILTERS = ['all', 'needsAction', 'rubricNotApproved'] as const;
export type JobFilter = (typeof JOB_FILTERS)[number];

export const parseFilter = (value: string | null): JobFilter => JOB_FILTERS.find((filter) => filter === value) ?? 'all';

// A rubric awaiting approval waits on the hiring owner, not on the recruiter.
const needsYourAction = (row: JobRow) => row.nextAction !== null && row.nextAction.kind !== 'rubric_approval_pending';

const matches: Record<JobFilter, (row: JobRow) => boolean> = {
  all: () => true,
  needsAction: needsYourAction,
  rubricNotApproved: (row) => !row.rubric.approved,
};

export const filterJobs = (rows: JobRow[], filter: JobFilter) => rows.filter(matches[filter]);

export const filterCounts = (rows: JobRow[]) =>
  Object.fromEntries(JOB_FILTERS.map((filter) => [filter, filterJobs(rows, filter).length])) as Record<
    JobFilter,
    number
  >;

/** An approved version in force reads "Approved"; otherwise the latest version's status, none yet reading as a draft. */
export const rubricLabel = ({ approved, latest }: RubricState) =>
  approved ? 'approved' : latest === 'awaiting_approval' || latest === 'returned' ? latest : 'draft';

/** A job without an approved rubric opens on its rubric; with one, on its ranked candidates (docs/01-design/screens.md). */
export const jobHref = (row: Pick<JobRow, 'id' | 'rubric'>) =>
  `/app/jobs/${row.id}/${row.rubric.approved ? 'candidates' : 'rubric'}`;
