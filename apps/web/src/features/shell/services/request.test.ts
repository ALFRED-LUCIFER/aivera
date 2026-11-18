import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadShellCounts, requireScreen } from './request.ts';
import { setTheme } from './theme.ts';

const cookieSet = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({ set: cookieSet }) }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

afterEach(() => vi.unstubAllEnvs());

describe('Scenario: Counts fail softly', () => {
  it('a failed counts read gives null, so the sidebar shows names without numbers', async () => {
    expect(await loadShellCounts(() => Promise.reject(new Error('down')))).toBeNull();
    expect(await loadShellCounts()).toEqual({ desk: 4, inbox: 20, jobs: 5, interviews: 5, packs: 1 });
  });
});

describe('requireScreen', () => {
  it('lets the development stand-in recruiter open a mapped screen', async () => {
    expect((await requireScreen('desk')).workspace).toEqual({ name: 'Demo', synthetic: true });
  });

  // SAFETY: mutation check: removed the NODE_ENV production check in devStandInMember -> this test failed
  it('renders no recruiter page in production, where the stand-in does not exist', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(requireScreen('desk')).rejects.toThrow('NEXT_NOT_FOUND');
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
