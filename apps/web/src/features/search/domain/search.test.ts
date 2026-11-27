import { describe, expect, it } from 'vitest';
import { matches, MAX_PER_GROUP, resultHrefs, searchResults, searchSchema } from './search.ts';

// AIV-P1-049: the top-bar search's matching. Synthetic cast only (docs/00-product/personas.md).
const hrefs = {
  job: (id: string) => `/app/jobs/${id}`,
  person: (p: string, j: string) => `/app/candidates/${p}?job=${j}`,
};
const ai = {
  id: 'j-ai',
  title: 'Senior AI Engineer',
  applicants: [
    { personId: 'p-sara', displayName: 'Sara Al Qahtani' },
    { personId: 'p-arjun', displayName: 'Arjun Menon' },
    { personId: 'p-unnamed', displayName: null },
  ],
};
const qa = {
  id: 'j-qa',
  title: 'QA Automation Engineer',
  applicants: [
    { personId: 'p-sara', displayName: 'Sara Al Qahtani' },
    { personId: 'p-hessa', displayName: 'Hessa Al Mazrouei' },
  ],
};

describe('Scenario: Find a candidate', () => {
  it('"Sara" finds Sara Al Qahtani once, on her first job: "Sara Al Qahtani · Senior AI Engineer"', () => {
    expect(searchResults('Sara', [ai, qa], hrefs)).toEqual({
      jobs: [],
      candidates: [
        {
          personId: 'p-sara',
          name: 'Sara Al Qahtani',
          job: 'Senior AI Engineer',
          href: '/app/candidates/p-sara?job=j-ai',
        },
      ],
    });
  });

  it('matches jobs by title and people by name, ignoring case and accents', () => {
    expect(searchResults('qa', [ai, qa], hrefs).jobs).toEqual([
      { id: 'j-qa', title: 'QA Automation Engineer', href: '/app/jobs/j-qa' },
    ]);
    expect(matches('José Ortega', 'jose')).toBe(true);
    expect(matches('Hessa', 'HESS')).toBe(true);
  });
});

describe('Scenario: No results', () => {
  it('"zzzz" finds nothing in either group', () => {
    expect(searchResults('zzzz', [ai, qa], hrefs)).toEqual({ jobs: [], candidates: [] });
  });
});

describe('results', () => {
  it('stop at five per group', () => {
    const many = Array.from({ length: 8 }, (_, n) => ({ id: `j${n}`, title: `Engineer ${n}`, applicants: [] }));
    expect(searchResults('engineer', many, hrefs).jobs).toHaveLength(MAX_PER_GROUP);
  });

  it('read jobs then people, in order: Enter opens the first', () => {
    expect(resultHrefs(searchResults('a', [ai, qa], hrefs))).toEqual([
      '/app/jobs/j-ai',
      '/app/jobs/j-qa',
      '/app/candidates/p-sara?job=j-ai',
      '/app/candidates/p-arjun?job=j-ai',
      '/app/candidates/p-hessa?job=j-qa',
    ]);
  });

  it('the posted query is trimmed text of 1 to 100 characters, nothing else', () => {
    expect(searchSchema.parse({ query: '  Sara ' })).toEqual({ query: 'Sara' });
    expect(searchSchema.safeParse({ query: '   ' }).success).toBe(false);
    expect(searchSchema.safeParse({ query: 'x'.repeat(101) }).success).toBe(false);
    expect(searchSchema.safeParse({ query: 'Sara', jobId: 'j' }).success).toBe(false);
  });
});
