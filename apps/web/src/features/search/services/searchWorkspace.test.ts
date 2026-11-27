import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchWorkspace } from './searchWorkspace.ts';

// AIV-P1-049: the top-bar search's read, with the workspace context, jobs and intake faked. Workspace isolation itself
// is the contracts' (RLS and the repository filter), proven in tests/integration and tests/e2e/src/search.spec.ts.
// Synthetic cast only.
const ctx = { userId: 'u1', workspaceId: '0190d4a2-0000-7000-8000-000000000001', role: 'recruiter', tx: {} };
const fake = vi.hoisted(() => ({ workspace: vi.fn(), jobs: vi.fn(), list: vi.fn() }));
vi.mock('@/server/workspace', () => ({ inActiveWorkspace: fake.workspace }));
vi.mock('@/server/jobs', () => ({ getJobs: () => ({ listJobs: fake.jobs }) }));
vi.mock('@/server/intake', () => ({ getIntake: () => ({ listApplicationsForJob: fake.list }) }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));

afterEach(() => vi.restoreAllMocks());

describe('searchWorkspace', () => {
  // SAFETY: mutation check: logged parsed.data.query under the allowlisted `credalent.search.jobs` key -> this test failed (the line contained "Sara")
  it("finds the member's jobs and applicants, and logs counts only, never the query or a name", async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    fake.workspace.mockImplementation(async (fn: (c: typeof ctx) => Promise<unknown>) => ({ value: await fn(ctx) }));
    fake.jobs.mockResolvedValue([{ id: 'j-ai', title: 'Senior AI Engineer' }]);
    fake.list.mockResolvedValue([{ personId: 'p-sara', displayName: 'Sara Al Qahtani' }]);

    expect(await searchWorkspace({ query: 'Sara' })).toEqual({
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
    expect(fake.list).toHaveBeenCalledWith(ctx, 'j-ai');
    const logged = write.mock.calls.map(([line]) => String(line)).join('');
    expect(logged).toContain('workspace searched');
    expect(logged).not.toContain('Sara');
  });

  it('reads nothing for an empty query, and is null with no workspace', async () => {
    expect(await searchWorkspace({ query: '  ' })).toEqual({ jobs: [], candidates: [] });
    expect(fake.workspace).not.toHaveBeenCalled();
    fake.workspace.mockResolvedValue(null);
    expect(await searchWorkspace({ query: 'Sara' })).toBeNull();
  });
});
