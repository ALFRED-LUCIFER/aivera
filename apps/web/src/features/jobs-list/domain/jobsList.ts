import type { DeskJob, RubricState } from '@credalent/jobs';

/** A Jobs list row as the page hands it to the browser: plain data, only what the table shows. */
export type JobRow = Pick<
  DeskJob,
  'id' | 'title' | 'team' | 'location' | 'stage' | 'rubric' | 'coveragePercent' | 'nextAction'
> & {
  hiringOwner: string | null;
  /** Candidates assessed on the approved rubric version; 0 before one is approved (AIV-P1-099). */
  assessed: number;
  /** The agency client's name; null for the team's own job (AIV-P1-056). */
  client: string | null;
};

export const toJobRow = (
  job: DeskJob,
  assessed: number,
  hiringOwner: string | null,
  client: string | null,
): JobRow => ({
  id: job.id,
  title: job.title,
  team: job.team,
  location: job.location,
  stage: job.stage,
  rubric: job.rubric,
  assessed,
  coveragePercent: job.coveragePercent,
  nextAction: job.nextAction,
  hiringOwner,
  client,
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

/** The agency's client filter: every client named on a job, by name; '' is every job. */
export const clientNames = (rows: JobRow[]) =>
  [...new Set(rows.flatMap((row) => row.client ?? []))].toSorted((a, b) => a.localeCompare(b));
export const filterByClient = (rows: JobRow[], client: string) =>
  client ? rows.filter((row) => row.client === client) : rows;

export const filterCounts = (rows: JobRow[]) =>
  Object.fromEntries(JOB_FILTERS.map((filter) => [filter, filterJobs(rows, filter).length])) as Record<
    JobFilter,
    number
  >;

/**
 * An approved version in force reads "Approved"; a returned one "Returned, needs changes"; any other, sent or not, "Draft,
 * needs approval" (AIV-P1-014, RoleNew artboard), and the next action column says whether it is with the hiring owner.
 */
export const rubricLabel = ({ approved, latest }: RubricState) =>
  approved ? 'approved' : latest === 'returned' ? latest : 'draft';

/** A job without an approved rubric opens on its rubric; with one, on its ranked candidates (docs/01-design/screens.md). */
export const jobHref = (row: Pick<JobRow, 'id' | 'rubric'>) =>
  `/app/jobs/${row.id}/${row.rubric.approved ? 'candidates' : 'rubric'}`;
