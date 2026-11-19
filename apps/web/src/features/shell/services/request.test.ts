import { describe, expect, it, vi } from 'vitest';
import type { Member } from '../domain/shell.ts';
import { loadShellCounts, requireScreen } from './request.ts';
import { setTheme } from './theme.ts';

const cookieSet = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ set: cookieSet }) }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const membership = vi.fn();
vi.mock('@/server/workspace', () => ({ currentMembership: () => membership() }));

const member = (synthetic: boolean): Member => ({
  name: 'AP',
  initials: 'AP',
  capabilities: ['recruiter'],
  workspace: { synthetic, status: 'active' },
});

describe('Scenario: Counts fail softly', () => {
  it('a failed counts read gives null, so the sidebar shows names without numbers', async () => {
    expect(await loadShellCounts(member(true), () => Promise.reject(new Error('down')))).toBeNull();
    expect(await loadShellCounts(member(true))).toEqual({ desk: 4, inbox: 20, jobs: 5, interviews: 5, packs: 1 });
  });

  // SAFETY: mutation check: removed the synthetic check in loadShellCounts -> this test failed
  it('never shows the seeded numbers for a workspace that is not synthetic', async () => {
    expect(await loadShellCounts(member(false))).toBeNull();
  });
});

describe('requireScreen', () => {
  it('lets a recruiter open a mapped screen', async () => {
    membership.mockResolvedValueOnce({ name: 'Alex Recruiter', role: 'recruiter', synthetic: true });
    expect(await requireScreen('desk')).toMatchObject({ initials: 'AR', workspace: { synthetic: true } });
  });

  // SAFETY: mutation check: gave every role the recruiter capability in shellMember -> this test failed
  it('is a 404 with no workspace, and for roles without the recruiter screens', async () => {
    membership.mockResolvedValueOnce(null);
    await expect(requireScreen('desk')).rejects.toThrow('NEXT_NOT_FOUND');
    for (const role of ['hiring_owner', 'interviewer'] as const) {
      membership.mockResolvedValueOnce({ name: 'Lina Panel', role, synthetic: true });
      await expect(requireScreen('desk')).rejects.toThrow('NEXT_NOT_FOUND');
    }
  });
});

describe('Scenario: Dark theme persists without a flash (cookie)', () => {
  // SAFETY: mutation check: set the raw theme instead of parseTheme(theme) -> this test failed
  it('stores light or dark only, for a year, httpOnly', async () => {
    await setTheme('dark');
    await setTheme('<script>');
    expect(cookieSet.mock.calls.map(([name, value]) => [name, value])).toEqual([
      ['theme', 'dark'],
      ['theme', 'light'],
    ]);
    expect(cookieSet.mock.calls[0]?.[2]).toMatchObject({ path: '/', httpOnly: true, sameSite: 'lax' });
  });
});
