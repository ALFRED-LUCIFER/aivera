// The public jobs list (AIV-P3-004): search, filter chips and paging over the open jobs, all from the URL.
import type { PublicJob } from '@credalent/jobs';
import { z } from 'zod';

/** The chip each job type counts under; a job type not listed counts under "all" only. */
// shortcut: the chips group catalogue version 1's job types by key; give job types a family in the catalogue when an
// operator adds one that should have a chip (AIV-P2-045).
export const FAMILY_OF: Partial<Record<string, 'engineering' | 'product' | 'sales' | 'support'>> = {
  software_engineering: 'engineering',
  qa_test_automation: 'engineering',
  ai_llm_engineering: 'engineering',
  forward_deployed_engineering: 'engineering',
  data_ml: 'engineering',
  devops_sre: 'engineering',
  product_management: 'product',
  product_design: 'product',
  sales: 'sales',
  technical_writing_support: 'support',
};
const FAMILIES = ['engineering', 'product', 'sales', 'support'] as const;

/** City chips, matched in the job's location ("DIFC, Dubai" is Dubai). */
// shortcut: three launch cities, matched as words in free-text locations; a location field per city comes with search
// facets once more cities list jobs.
export const CITIES = { dubai: 'Dubai', abu_dhabi: 'Abu Dhabi', riyadh: 'Riyadh' } as const;

export const FILTERS = ['all', ...FAMILIES, ...(Object.keys(CITIES) as (keyof typeof CITIES)[])] as const;
export type Filter = (typeof FILTERS)[number];

export const PAGE_SIZE = 20;

/** The URL's query, validated (AGENTS.md 3.7): anything unknown falls back to the full first page. */
export const jobsQuery = z.object({
  q: z.string().trim().max(100).catch(''),
  filter: z.enum(FILTERS).catch('all'),
  page: z.coerce.number().int().min(1).catch(1),
});
export type JobsQuery = z.infer<typeof jobsQuery>;

/** Next.js searchParams can repeat a key; the first value counts. */
export const parseJobsQuery = (params: Record<string, string | string[] | undefined>): JobsQuery => {
  const first = (key: string) => [params[key]].flat()[0] ?? '';
  return jobsQuery.parse({ q: first('q'), filter: first('filter'), page: first('page') || 1 });
};

const matchesSearch = (job: PublicJob, q: string) => {
  const needle = q.toLocaleLowerCase('en');
  return [job.title, ...job.competencies.map((c) => c.name)].some((text) =>
    text.toLocaleLowerCase('en').includes(needle),
  );
};

const matchesFilter = (job: PublicJob, filter: Filter) => {
  if (filter === 'all') return true;
  if (filter in CITIES) return (job.location ?? '').includes(CITIES[filter as keyof typeof CITIES]);
  return FAMILY_OF[job.jobType] === filter;
};

export type JobsListView = {
  /** The chips with a count over the searched jobs; families and cities with none are left out, unless chosen. */
  chips: { value: Filter; count: number }[];
  jobs: PublicJob[];
  page: number;
  pageCount: number;
};

/** Search (title or skill), then the chip, then the page; `jobs` comes newest first and keeps that order. */
export function jobsListView(all: readonly PublicJob[], { q, filter, page }: JobsQuery): JobsListView {
  const searched = q ? all.filter((job) => matchesSearch(job, q)) : [...all];
  const chips = FILTERS.map((value) => ({
    value,
    count: searched.filter((job) => matchesFilter(job, value)).length,
  })).filter(({ value, count }) => value === 'all' || value === filter || count > 0);
  const filtered = searched.filter((job) => matchesFilter(job, filter));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  return { chips, jobs: filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), page: current, pageCount };
}

/** Whole days since the job was posted, by the server's clock, so server and browser print the same words. */
export const postedDaysAgo = (postedAt: Date, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - postedAt.getTime()) / 86_400_000));

/** The list URL for a query, leaving defaults out so links stay short and shareable. */
export function jobsHref({ q, filter, page }: Partial<JobsQuery>): `/candidates/jobs${string}` {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (filter && filter !== 'all') params.set('filter', filter);
  if (page && page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `/candidates/jobs?${query}` : '/candidates/jobs';
}

/** What a job card shows: the public listing's headline facts, with the posted age already worked out. */
export type JobCardData = {
  slug: string;
  title: string;
  descriptor: string;
  location: string | null;
  /** The job type's name from the published catalogue. */
  jobTypeLabel: string;
  postedDays: number;
};
