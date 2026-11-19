import { beforeEach, describe, expect, it, vi } from 'vitest';
import CandidateMeLayout from './layout.tsx';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/server/candidateAuth', () => ({ getCandidateSessionUserId: async () => session.userId }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT;${to}`);
  },
}));

beforeEach(() => {
  session.userId = null;
});

// The server-side check behind the proxy (AIV-P0-011): My applications never renders without a candidate session.
describe('CandidateMeLayout', () => {
  // SAFETY: mutation check: removed the redirect line from layout.tsx -> this test failed
  it('sends a request with no candidate session to the candidate sign-in', async () => {
    await expect(CandidateMeLayout({ children: 'My applications' })).rejects.toThrow(
      'NEXT_REDIRECT;/candidates/sign-in',
    );
  });

  it('renders the page for a signed-in candidate', async () => {
    session.userId = 'candidate-user';
    await expect(CandidateMeLayout({ children: 'My applications' })).resolves.toBe('My applications');
  });
});
