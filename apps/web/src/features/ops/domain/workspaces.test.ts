import { describe, expect, it } from 'vitest';
import { pageCount, toDirectorySearch, workspaceSearchSchema } from './workspaces.ts';

// AIV-P2-036: the list request's schema and paging.
describe('workspaceSearchSchema', () => {
  it('trims the name search and keeps the page', () => {
    expect(workspaceSearchSchema.parse({ query: '  gulf ', page: 2 })).toEqual({ query: 'gulf', page: 2 });
  });

  it.each([
    ['a search over 100 characters', { query: 'x'.repeat(101), page: 1 }],
    ['page 0', { query: '', page: 0 }],
    ['a fractional page', { query: '', page: 1.5 }],
    ['a page sent as text', { query: '', page: '1' }],
    ['no query', { page: 1 }],
  ])('refuses %s', (_, input) => {
    expect(workspaceSearchSchema.safeParse(input).success).toBe(false);
  });
});

describe('paging: 50 per page', () => {
  it('page 1 starts at 0 and page 3 at 100, 50 each', () => {
    expect(toDirectorySearch({ query: 'gulf', page: 1 })).toEqual({ query: 'gulf', offset: 0, limit: 50 });
    expect(toDirectorySearch({ query: '', page: 3 })).toEqual({ query: '', offset: 100, limit: 50 });
  });

  it.each([
    [0, 1],
    [50, 1],
    [51, 2],
    [120, 3],
  ])('%i workspaces make %i pages', (total, pages) => {
    expect(pageCount(total)).toBe(pages);
  });
});
