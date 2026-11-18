import type { PublicJob } from '@aivera/jobs';
import { describe, expect, it } from 'vitest';
import { newJobs } from './new-jobs.ts';

const job = (title: string, daysAgo: number): PublicJob => ({
  slug: title.toLowerCase().replaceAll(' ', '-'),
  title,
  jobType: 'sales',
  descriptor: 'A synthetic employer',
  location: 'Dubai',
  payBand: null,
  competencies: [],
  postedAt: new Date(Date.UTC(2026, 10, 19 - daysAgo)),
});

describe('newJobs (AIV-P3-003)', () => {
  it('lists the newest first and caps at three', () => {
    const jobs = [job('A', 9), job('B', 6), job('C', 12), job('D', 2)];
    expect(newJobs(jobs).map((j) => j.title)).toEqual(['D', 'B', 'A']);
  });

  it('no jobs gives none', () => {
    expect(newJobs([])).toEqual([]);
  });
});
