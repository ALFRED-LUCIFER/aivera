import type { Stage } from '@credalent/intake';
import type { CandidateRow, CandidateScore } from '@/features/ranking/domain/ranking.ts';

// AIV-P1-048: everyone in a live process on one of the workspace's jobs, one row per person.

/**
 * A live process, least to furthest along; the talent pool and withdrawn are outside it and not listed. Not advanced
 * stays on its live job and can join a later pack (intake's domain), so it is listed, last: its Round 1 ended in a no.
 * In process has no setter yet; it sits with assessment, before anyone is chosen for interview.
 */
const PROGRESS: readonly Stage[] = [
  'not_advanced',
  'new',
  'first_pass_done',
  'assessing',
  'in_process',
  'interview',
  'round2_shortlist',
];

/** One job a person is assessed on, with that job's ranking row. */
export type PersonJob = { jobId: string; jobTitle: string; row: CandidateRow & { score: CandidateScore } };

/** A person's row: the job it shows, and the person's other live jobs, furthest along first. */
export type PersonRow = { personId: string; job: PersonJob; others: PersonJob[] };

/** A job tab: its live people, never zero. */
export type JobTab = { id: string; title: string; count: number };

export type PeopleData = { jobs: JobTab[]; people: PersonRow[] };

/** "All jobs", the tab value when no job is chosen. */
export const ALL_JOBS = 'all';

// An undecided shortlist pack is past Round 1 interviews (the Gherkin "Sorted furthest along first") but not past a
// recorded Round 2 shortlist, which a decided pack leads to; then the higher backed score.
const IN_PACK = PROGRESS.indexOf('interview') + 0.5;
const progress = ({ row }: PersonJob) =>
  row.inPack ? Math.max(IN_PACK, PROGRESS.indexOf(row.stage)) : PROGRESS.indexOf(row.stage);
const furtherFirst = (a: PersonJob, b: PersonJob) =>
  progress(b) - progress(a) || b.row.score.backedScore - a.row.score.backedScore;

/**
 * Folds each job's ranking rows into one row per person, showing their furthest-along job. Only assessed people at a
 * live stage are listed: the Inbox's not yet assessed and the talent pool are not mixed in.
 */
export function toPeople(jobs: { id: string; title: string; rows: CandidateRow[] }[]): PeopleData {
  const byPerson = new Map<string, PersonJob[]>();
  const tabs: JobTab[] = [];
  for (const { id, title, rows } of jobs) {
    let count = 0;
    for (const row of rows) {
      if (!row.score || !PROGRESS.includes(row.stage)) continue;
      const job = { jobId: id, jobTitle: title, row: { ...row, score: row.score } };
      byPerson.set(row.personId, [...(byPerson.get(row.personId) ?? []), job]);
      count++;
    }
    if (count > 0) tabs.push({ id, title, count });
  }
  return { jobs: tabs, people: rowsFor([...byPerson], () => true) };
}

/** The rows a tab shows: every person, or the people on that job with that job's figures. */
export function peopleOnTab(data: PeopleData, tab: string): PersonRow[] {
  if (tab === ALL_JOBS) return data.people;
  return rowsFor(
    data.people.map(({ personId, job, others }) => [personId, [job, ...others]] as const),
    (job) => job.jobId === tab,
  );
}

function rowsFor(people: (readonly [string, PersonJob[]])[], shown: (job: PersonJob) => boolean): PersonRow[] {
  return people
    .flatMap(([personId, jobs]) => {
      const sorted = jobs.toSorted(furtherFirst);
      const job = sorted.find(shown);
      return job ? [{ personId, job, others: sorted.filter((other) => other !== job) }] : [];
    })
    .toSorted((a, b) => furtherFirst(a.job, b.job));
}

/** A tab value from the URL; an unknown job is "All jobs". */
export const parseTab = (value: string | null, data: PeopleData) =>
  data.jobs.find((job) => job.id === value)?.id ?? ALL_JOBS;
