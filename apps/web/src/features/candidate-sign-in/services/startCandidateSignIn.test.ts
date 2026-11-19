import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startCandidateSignIn } from './startCandidateSignIn';

const auth = vi.hoisted(() => ({ configured: true, signIn: vi.fn() }));
vi.mock('@/server/candidateAuth', () => ({
  candidateAuthConfigured: () => auth.configured,
  signIn: auth.signIn,
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT;${to}`);
  },
}));

// A crafted post can carry an email; it must still never reach the tenant's URL.
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

beforeEach(() => {
  auth.configured = true;
  auth.signIn.mockReset();
});

describe('startCandidateSignIn', () => {
  // Scenario: Only the two chosen ways in are offered, without the email in the URL.
  // SAFETY: mutation check: passed { login_hint: form.get('email') } as signIn's third argument -> this test failed
  it('sends no login_hint and no email to the tenant, only the sanitised next and prompt=login', async () => {
    await startCandidateSignIn(form({ next: '/candidates/me', email: 'sara@example.com', login_hint: 'x' }));
    expect(auth.signIn).toHaveBeenCalledTimes(1);
    expect(auth.signIn.mock.calls[0]).toEqual(['entra', { redirectTo: '/candidates/me' }, { prompt: 'login' }]);
    expect(JSON.stringify(auth.signIn.mock.calls)).not.toMatch(/login_hint|@example\.com/);
  });

  it('never returns a candidate to the recruiter app', async () => {
    await startCandidateSignIn(form({ next: '/app/jobs' }));
    expect(auth.signIn.mock.calls[0]?.[1]).toEqual({ redirectTo: '/candidates/me' });
  });

  // Scenario: Sign-in not set up in this environment.
  it('answers "not set up" when the candidate settings are missing', async () => {
    auth.configured = false;
    await expect(startCandidateSignIn(form({ next: '/candidates/me' }))).rejects.toThrow(
      'NEXT_REDIRECT;/candidates/sign-in?error=unavailable',
    );
    expect(auth.signIn).not.toHaveBeenCalled();
  });
});
