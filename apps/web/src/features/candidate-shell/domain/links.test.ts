import { describe, expect, it } from 'vitest';
import { isCurrent, sitePages } from './links.ts';

describe('isCurrent', () => {
  it('matches the page and the pages under it, not a sibling that shares a prefix', () => {
    expect(isCurrent('/candidates/jobs', '/candidates/jobs')).toBe(true);
    expect(isCurrent('/candidates/jobs/qa-lead', '/candidates/jobs')).toBe(true);
    expect(isCurrent('/candidates/jobsearch', '/candidates/jobs')).toBe(false);
    expect(isCurrent('/candidates', '/candidates/jobs')).toBe(false);
  });
});

describe('sitePages', () => {
  it('names every page the frame links to, and nothing outside the candidate site', () => {
    expect([...sitePages.keys()].toSorted()).toEqual([
      '/candidates/cv-check',
      '/candidates/jobs',
      '/candidates/me',
      '/candidates/plans',
      '/candidates/plus/address',
      '/candidates/signup',
    ]);
  });
});
