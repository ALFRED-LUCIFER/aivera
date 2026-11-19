import { beforeEach, describe, expect, it, vi } from 'vitest';
import CandidateMeLayout from './layout.tsx';

const session = vi.hoisted(() => ({ userId: null as string | null }));
const account = vi.hoisted(() => ({ fullName: null as string | null, workType: null as string | null }));
vi.mock('@/server/candidateAuth', () => ({ getCandidateSessionUserId: async () => session.userId }));
vi.mock('@/server/candidateAccounts', () => ({
  getCandidateAccounts: () => ({
    withAccount: async (_id: string, work: (ctx: object) => Promise<unknown>) => work({}),
    getMyAccount: async () => account,
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT;${to}`);
  },
}));

beforeEach(() => {
  session.userId = null;
  account.fullName = null;
  account.workType = null;
});

// The server-side check behind the proxy (AIV-P0-011): My applications never renders without a candidate session.
describe('CandidateMeLayout', () => {
  // SAFETY: mutation check: removed the redirect line from layout.tsx -> this test failed
  it('sends a request with no candidate session to the candidate sign-in', async () => {
    await expect(CandidateMeLayout({ children: 'My applications' })).rejects.toThrow(
      'NEXT_REDIRECT;/candidates/sign-in',
    );
  });

  // AIV-P3-007: Scenario: A recruiter's email becomes the same login on the candidate site.
  it('sends a signed-in person with no full name and kind of work to finish sign-up', async () => {
    session.userId = 'candidate-user';
    await expect(CandidateMeLayout({ children: 'My applications' })).rejects.toThrow(
      'NEXT_REDIRECT;/candidates/signup',
    );
  });

  it('renders the page for a signed-up candidate', async () => {
    session.userId = 'candidate-user';
    account.fullName = 'Layla Haddad';
    account.workType = 'ai_llm_engineering';
    await expect(CandidateMeLayout({ children: 'My applications' })).resolves.toBe('My applications');
  });
});
