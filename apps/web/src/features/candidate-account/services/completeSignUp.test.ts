import { CandidateAccountError } from '@aivera/candidate-accounts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialSignUpState } from '../domain/signup.ts';
import { completeSignUp } from './completeSignUp.ts';

const session = vi.hoisted(() => ({ userId: 'session-user' as string | null }));
const accounts = vi.hoisted(() => ({
  withAccount: vi.fn(async (id: string, work: (ctx: { accountId: string }) => Promise<unknown>) =>
    work({ accountId: id }),
  ),
  signUp: vi.fn(async () => ({})),
}));
const log = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/server/candidateAuth', () => ({ getCandidateSessionUserId: async () => session.userId }));
vi.mock('@/server/candidateAccounts', () => ({ getCandidateAccounts: () => accounts }));
vi.mock('@/server/jobs', () => ({
  getCatalogue: () => ({
    getPublishedCatalogue: async () => (await import('@/test/catalogue-v1.ts')).CATALOGUE_V1,
  }),
}));
vi.mock('@aivera/observability', () => ({ log }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT;${to}`);
  },
}));

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const submit = (fields: Record<string, string>) => completeSignUp(initialSignUpState(''), form(fields));
const layla = { fullName: 'Layla Haddad', workType: 'ai_llm_engineering' };

beforeEach(() => {
  vi.clearAllMocks();
  session.userId = 'session-user';
});

describe('completeSignUp (server action)', () => {
  // Scenario: Creating a free account after the tenant's sign-up.
  it("records the full name and work type on the session user's account and lands on My applications", async () => {
    await expect(submit(layla)).rejects.toThrow('NEXT_REDIRECT;/candidates/me');
    expect(accounts.signUp).toHaveBeenCalledWith({ accountId: 'session-user' }, layla);
  });

  // Scenario: Signing in returns me where I was (a new candidate signs up on the way).
  it('lands on the sanitised next after sign-up, never outside the candidate site', async () => {
    await expect(submit({ ...layla, next: '/candidates/jobs/senior-ai-engineer/apply' })).rejects.toThrow(
      'NEXT_REDIRECT;/candidates/jobs/senior-ai-engineer/apply',
    );
    await expect(submit({ ...layla, next: '/app/jobs' })).rejects.toThrow('NEXT_REDIRECT;/candidates/me');
  });

  // SAFETY: mutation check: used form.get('userId') as the account id in completeSignUp -> this test failed
  it('ignores any user id in the form: the account is always the session user', async () => {
    await expect(submit({ ...layla, userId: 'someone-else', accountId: 'someone-else' })).rejects.toThrow(
      'NEXT_REDIRECT;/candidates/me',
    );
    expect(accounts.withAccount).toHaveBeenCalledTimes(1);
    expect(accounts.withAccount.mock.calls[0]?.[0]).toBe('session-user');
  });

  // SAFETY: mutation check: removed the session check from completeSignUp -> this test failed
  it('sends a request with no candidate session to the candidate sign-in and records nothing', async () => {
    session.userId = null;
    await expect(submit(layla)).rejects.toThrow('NEXT_REDIRECT;/candidates/sign-in');
    expect(accounts.withAccount).not.toHaveBeenCalled();
  });

  // Scenario: Full name is required.
  it('returns the field error and records nothing when the full name is blank', async () => {
    await expect(submit({ ...layla, fullName: ' ' })).resolves.toMatchObject({
      errors: { fullName: 'fullNameRequired' },
      values: { fullName: ' ', workType: 'ai_llm_engineering' },
    });
    expect(accounts.withAccount).not.toHaveBeenCalled();
  });

  it('sends someone who already signed up to My applications', async () => {
    accounts.signUp.mockRejectedValueOnce(new CandidateAccountError('already_signed_up'));
    await expect(submit(layla)).rejects.toThrow('NEXT_REDIRECT;/candidates/me');
  });

  it('keeps what was typed on a failure and logs no personal data', async () => {
    accounts.signUp.mockRejectedValueOnce(new Error('duplicate key: Layla Haddad'));
    await expect(submit(layla)).resolves.toEqual({ errors: {}, failed: true, values: layla });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('Layla');
  });
});
