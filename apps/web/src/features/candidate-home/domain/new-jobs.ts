import type { PublicJob } from '@aivera/jobs';

/** "New this week" on the candidate home page (AIV-P3-003): the three most recently posted open jobs. */
const NEW_JOBS = 3;

export const newJobs = (jobs: readonly PublicJob[]): PublicJob[] =>
  jobs.toSorted((a, b) => b.postedAt.getTime() - a.postedAt.getTime()).slice(0, NEW_JOBS);
