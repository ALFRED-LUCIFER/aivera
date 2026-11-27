import { z } from 'zod';

// AIV-P1-049: the top-bar search over the workspace's jobs and candidates. Evidence by meaning is AIV-P1-162 (#662).

/** What the palette posts: the typed text, trimmed. It travels in the request body, never a URL, and is never logged. */
export const searchSchema = z.strictObject({ query: z.string().trim().min(1).max(100) });

/** At most this many results per group ("Jobs", "Candidates"). */
export const MAX_PER_GROUP = 5;

export type JobResult = { id: string; title: string; href: string };
/** One person, on the first of their jobs that matched: "Sara Al Qahtani · Senior AI Engineer". */
export type CandidateResult = { personId: string; name: string; job: string; href: string };
export type SearchResults = { jobs: JobResult[]; candidates: CandidateResult[] };

/** Lower case with accents removed, so "hessa" finds "Hessa" and "jose" finds "José". */
const folded = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en');

export const matches = (text: string, query: string) => folded(text).includes(folded(query.trim()));

type JobInput = { id: string; title: string; applicants: { personId: string; displayName: string | null }[] };

/** The matching jobs by title and people by name, at most `MAX_PER_GROUP` each, in the jobs' order. */
export function searchResults(
  query: string,
  jobs: JobInput[],
  hrefs: { job: (jobId: string) => string; person: (personId: string, jobId: string) => string },
): SearchResults {
  const candidates = new Map<string, CandidateResult>();
  for (const job of jobs)
    for (const { personId, displayName } of job.applicants)
      if (displayName && !candidates.has(personId) && matches(displayName, query))
        candidates.set(personId, { personId, name: displayName, job: job.title, href: hrefs.person(personId, job.id) });
  return {
    jobs: jobs
      .filter((job) => matches(job.title, query))
      .slice(0, MAX_PER_GROUP)
      .map((job) => ({ id: job.id, title: job.title, href: hrefs.job(job.id) })),
    candidates: [...candidates.values()].slice(0, MAX_PER_GROUP),
  };
}

/** The results' links in reading order: jobs, then people. Enter in the search box opens the first. */
export const resultHrefs = ({ jobs, candidates }: SearchResults) => [
  ...jobs.map((job) => job.href),
  ...candidates.map((person) => person.href),
];

export type SearchView = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** `idle` before anything is typed; `done` with the results of the query shown. */
  status: 'idle' | 'searching' | 'done' | 'error';
  results: SearchResults;
  /** Enter in the search box opens the first result. */
  onKeyDown: (event: { key: string; preventDefault: () => void }) => void;
  /** A result was followed: the palette closes. */
  onChosen: () => void;
};
