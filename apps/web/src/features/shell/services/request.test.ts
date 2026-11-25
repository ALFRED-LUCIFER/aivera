import { describe, expect, it, vi } from 'vitest';
import { requireScreen } from './request.ts';
import { setTheme } from './theme.ts';

const cookieSet = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ set: cookieSet }) }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const flags = vi.hoisted(() => new Set<string>());
vi.mock('@/server/flags', () => ({ enabledFlags: flags }));

const membership = vi.fn();
vi.mock('@/server/workspace', () => ({ currentMembership: () => membership() }));

describe('requireScreen', () => {
  it('lets a recruiter open a mapped screen', async () => {
    membership.mockResolvedValueOnce({ name: 'Alex Recruiter', role: 'recruiter', synthetic: true });
    expect(await requireScreen('desk')).toMatchObject({ initials: 'AR', workspace: { synthetic: true } });
  });

  it('is a 404 with no workspace', async () => {
    membership.mockResolvedValueOnce(null);
    await expect(requireScreen('desk')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  // SAFETY: mutation check: gave every role the recruiter capability in shellMember -> this test failed (settings opened)
  it('hiring owners and interviewers open the desk, jobs and interviews, and 404 on the recruiter-only screens (AIV-P1-091)', async () => {
    for (const role of ['hiring_owner', 'interviewer'] as const) {
      for (const screen of ['desk', 'jobs', 'interviews'] as const) {
        membership.mockResolvedValueOnce({ name: 'Lina Panel', role, synthetic: true });
        expect(await requireScreen(screen)).toMatchObject({ initials: 'LP' });
      }
      membership.mockResolvedValueOnce({ name: 'Lina Panel', role, synthetic: true });
      await expect(requireScreen('settings')).rejects.toThrow('NEXT_NOT_FOUND');
    }
  });
});

describe('Scenario: A flag turns a section on (AIV-P1-095)', () => {
  const recruiter = { name: 'Alex Recruiter', role: 'recruiter', synthetic: true };

  // SAFETY: mutation check: removed the canOpen check from requireScreen -> this test failed
  it('a section with its flag off is a 404 by direct address, and opens once the flag is on', async () => {
    membership.mockResolvedValueOnce(recruiter);
    await expect(requireScreen('pool')).rejects.toThrow('NEXT_NOT_FOUND');
    flags.add('pool');
    membership.mockResolvedValueOnce(recruiter);
    expect(await requireScreen('pool')).toMatchObject({ initials: 'AR' });
    flags.delete('pool');
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
