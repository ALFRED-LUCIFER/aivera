import { describe, expect, it } from 'vitest';
import { accountLink, footerLinks, headerLinks, isCurrent } from './links.ts';

describe('isCurrent', () => {
  it('matches the page and the pages under it, not a sibling that shares a prefix', () => {
    expect(isCurrent('/candidates/jobs', '/candidates/jobs')).toBe(true);
    expect(isCurrent('/candidates/jobs/qa-lead', '/candidates/jobs')).toBe(true);
    expect(isCurrent('/candidates/jobsearch', '/candidates/jobs')).toBe(false);
    expect(isCurrent('/candidates', '/candidates/jobs')).toBe(false);
  });
});

describe('the frame links', () => {
  it('lead only to pages that exist (AIV-P1-095)', () => {
    const hrefs = [...headerLinks, accountLink, ...footerLinks].map(({ href }) => href).toSorted();
    expect(hrefs).toEqual(['/', '/candidates/jobs', '/candidates/jobs', '/candidates/signup']);
  });
});
