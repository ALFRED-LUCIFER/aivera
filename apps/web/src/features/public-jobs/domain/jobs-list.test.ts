import type { PublicJob } from '@aivera/jobs';
import { describe, expect, it } from 'vitest';
import { jobsHref, jobsListView, parseJobsQuery, postedDaysAgo, PAGE_SIZE } from './jobs-list.ts';

const day = (n: number) => new Date(Date.UTC(2026, 10, 19 - n, 9));
const job = (title: string, jobType: string, location: string, postedDaysBack: number, skills: string[] = []) =>
  ({
    slug: title.toLowerCase().replaceAll(/[^a-z]+/g, '-'),
    title,
    jobType,
    descriptor: 'A synthetic employer',
    location,
    payBand: null,
    competencies: skills.map((name) => ({ name, evidenceExpected: 'Work', levelNeeded: 4 })),
    postedAt: day(postedDaysBack),
  }) satisfies PublicJob;

// The ticket's five synthetic jobs, newest first as the read model returns them.
const FIVE = [
  job('Real Estate Sales Consultant', 'sales', 'Dubai', 2, ['Closing sales']),
  job('Senior AI Engineer', 'ai_llm_engineering', 'DIFC, Dubai', 6, ['LLM systems in production']),
  job('QA Automation Engineer', 'qa_test_automation', 'Dubai, hybrid', 9, ['Test automation design']),
  job('Senior Product Manager, Payments', 'product_management', 'Dubai Internet City', 9, ['Discovery to decision']),
  job('Senior Software Engineer, Banking', 'software_engineering', 'Dubai', 12, ['System design in production']),
];
const all = { q: '', filter: 'all', page: 1 } as const;

describe('Scenario: The list shows every published job with counts', () => {
  it('chips read All 5, Engineering 3, Product 1, Sales 1 and Dubai 5, and empty ones are left out', () => {
    expect(jobsListView(FIVE, all).chips).toEqual([
      { value: 'all', count: 5 },
      { value: 'engineering', count: 3 },
      { value: 'product', count: 1 },
      { value: 'sales', count: 1 },
      { value: 'dubai', count: 5 },
    ]);
  });
});

describe('Scenario Outline: Filtering by chip', () => {
  it.each([
    ['engineering', 3],
    ['product', 1],
    ['sales', 1],
    ['dubai', 5],
  ] as const)('%s shows %i jobs, newest first', (filter, count) => {
    const { jobs } = jobsListView(FIVE, { ...all, filter });
    expect(jobs).toHaveLength(count);
    expect(jobs.map((j) => j.postedAt.getTime())).toEqual(
      jobs.map((j) => j.postedAt.getTime()).toSorted((a, b) => b - a),
    );
  });

  it('the URL keeps the search and filter, and leaves defaults out', () => {
    expect(jobsHref({ q: 'AI', filter: 'engineering', page: 2 })).toBe(
      '/candidates/jobs?q=AI&filter=engineering&page=2',
    );
    expect(jobsHref({ q: '', filter: 'all', page: 1 })).toBe('/candidates/jobs');
  });
});

describe('Scenario: Searching by title or skill', () => {
  it('"QA" finds only QA Automation Engineer; a skill ("closing") finds its job; case does not matter', () => {
    expect(jobsListView(FIVE, { ...all, q: 'QA' }).jobs.map((j) => j.title)).toEqual(['QA Automation Engineer']);
    expect(jobsListView(FIVE, { ...all, q: 'closing' }).jobs.map((j) => j.title)).toEqual([
      'Real Estate Sales Consultant',
    ]);
  });

  it('the chosen chip stays, with 0, when a search leaves it empty', () => {
    expect(jobsListView(FIVE, { q: 'QA', filter: 'sales', page: 1 }).chips).toContainEqual({
      value: 'sales',
      count: 0,
    });
  });

  it('chip counts follow the search', () => {
    expect(jobsListView(FIVE, { ...all, q: 'senior' }).chips).toEqual([
      { value: 'all', count: 3 },
      { value: 'engineering', count: 2 },
      { value: 'product', count: 1 },
      { value: 'dubai', count: 3 },
    ]);
  });
});

describe('Scenario: No results', () => {
  it('"Pastry chef" finds nothing', () => {
    expect(jobsListView(FIVE, { ...all, q: 'Pastry chef' }).jobs).toEqual([]);
  });
});

describe('Scenario: Unpublished jobs never appear', () => {
  it('with Senior AI Engineer gone from the read model, All reads 4', () => {
    const open = FIVE.filter((j) => j.title !== 'Senior AI Engineer');
    expect(jobsListView(open, all).chips[0]).toEqual({ value: 'all', count: 4 });
  });
});

describe('paging and the query string', () => {
  const many = Array.from({ length: PAGE_SIZE + 3 }, (_, i) => job(`Job ${i}`, 'sales', 'Riyadh', i));

  it('shows 20 a page; a page past the end shows the last page', () => {
    expect(jobsListView(many, all)).toMatchObject({ page: 1, pageCount: 2 });
    expect(jobsListView(many, { ...all, page: 2 }).jobs).toHaveLength(3);
    expect(jobsListView(many, { ...all, page: 9 })).toMatchObject({ page: 2 });
  });

  it('parses the URL, and falls back on anything unknown', () => {
    expect(parseJobsQuery({ q: ' AI ', filter: 'engineering', page: '2' })).toEqual({
      q: 'AI',
      filter: 'engineering',
      page: 2,
    });
    expect(parseJobsQuery({ q: ['a', 'b'], filter: 'weights', page: '-1' })).toEqual({
      q: 'a',
      filter: 'all',
      page: 1,
    });
    expect(parseJobsQuery({ q: 'x'.repeat(101) })).toEqual({ q: '', filter: 'all', page: 1 });
  });

  it('posted age is whole days by the server clock, never negative', () => {
    expect(postedDaysAgo(day(2), day(0))).toBe(2);
    expect(postedDaysAgo(day(0), day(2))).toBe(0);
  });
});
