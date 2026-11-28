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
  /** That client's opaque id, which the filter and its URL use; null with `client`. */
  clientId: string | null;
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
  clientId: client === null ? null : job.clientId,
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

/** A client the agency's filter offers. The id is what the URL carries, never the name (AIV-P1-165). */
export type ClientOption = { id: string; name: string };

/** The `?client=` value when it is one of the workspace's clients, else '' (every job). */
export const parseClient = (value: string | null, clients: readonly ClientOption[] | null) =>
  clients?.find((client) => client.id === value)?.id ?? '';

/** The agency's client filter, by client id; '' is every job. */
export const filterByClient = (rows: JobRow[], clientId: string) =>
  clientId ? rows.filter((row) => row.clientId === clientId) : rows;

/**
 * The row's one button for an admin or recruiter (AIV-P1-165): where the job's next action is done. A rubric to approve
 * opens the rubric; an approved job with nothing else known to do takes CVs. Null: the next action is read, not done here.
 */
export const rowButton = (row: Pick<JobRow, 'rubric' | 'nextAction'>): 'rubric' | 'import' | null =>
  row.nextAction?.kind === 'approve_rubric'
    ? 'rubric'
    : row.nextAction === null && row.rubric.approved
      ? 'import'
      : null;

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
