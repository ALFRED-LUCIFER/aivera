import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchWorkspaces } from './searchWorkspaces.ts';

// AIV-P2-036: the list's server action, called directly. Synthetic opaque ids.
const PIA = '0190d4a2-0000-7000-8000-00000000a001';
const operator = vi.fn<() => Promise<{ userId: string }>>();
const listWorkspaceFacts = vi.fn(async (_search: unknown, _sort?: unknown) => ({ total: 0, rows: [] }));

vi.mock('@/server/operator', () => ({
  platformOperator: () => operator(),
  listWorkspaceFacts: (search: unknown, sort?: unknown) => listWorkspaceFacts(search, sort),
}));

beforeEach(() => {
  vi.clearAllMocks();
  operator.mockResolvedValue({ userId: PIA });
});

describe('searchWorkspaces (server action)', () => {
  it('Scenario: Searching by name: reads the page the trimmed search asks for, 50 per page', async () => {
    expect(await searchWorkspaces({ query: ' gulf ', page: 2 })).toEqual({
      search: { query: 'gulf', page: 2 },
      total: 0,
      rows: [],
    });
    expect(listWorkspaceFacts).toHaveBeenCalledWith({ query: 'gulf', offset: 50, limit: 50 }, undefined);
  });

  it('AIV-P2-051: keeps the status filter and the AI sort from the console home link', async () => {
    await searchWorkspaces({ query: '', page: 1, status: 'active', sort: 'ai' });
    expect(listWorkspaceFacts).toHaveBeenCalledWith({ query: '', offset: 0, limit: 50, status: 'active' }, 'ai');
  });

  it('refuses input outside the schema and reads nothing', async () => {
    await expect(searchWorkspaces({ query: '', page: 0 })).rejects.toThrow();
    expect(listWorkspaceFacts).not.toHaveBeenCalled();
  });

  // SAFETY: mutation check: removed `await platformOperator()` from searchWorkspaces -> this test failed (facts read)
  it('Scenario: Non-operators are refused: a direct call is a 403 and returns no workspace facts', async () => {
    operator.mockRejectedValue(new Error('NEXT_HTTP_ERROR_FALLBACK;403'));
    await expect(searchWorkspaces({ query: '', page: 1 })).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;403');
    expect(listWorkspaceFacts).not.toHaveBeenCalled();
  });
});
