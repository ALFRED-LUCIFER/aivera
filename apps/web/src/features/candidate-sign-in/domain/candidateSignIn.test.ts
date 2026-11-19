import { describe, expect, it } from 'vitest';
import { signInPath } from '@/features/sign-in/domain/signIn.ts';
import { CANDIDATE_HOME, CANDIDATE_SIGN_IN, candidateSafeNext } from './candidateSignIn';

describe('candidateSafeNext', () => {
  it.each(['/candidates/me', '/candidates', '/candidates/jobs?q=qa#top', '/candidates?x=1'])('keeps %s', (path) => {
    expect(candidateSafeNext(path)).toBe(path);
  });

  // SAFETY: mutation check: returned the parsed path without the /candidates check -> the /app and dot-segment cases failed
  it.each([
    '/app',
    '/app/jobs',
    '/candidatesx',
    '/candidates/../app',
    'https://evil.example/candidates',
    '//evil.example/candidates',
    '/\\evil.example/candidates',
    '/.//evil.example/candidates',
    '/%2e//evil.example',
    'javascript:alert(1)',
    'candidates',
    '',
    undefined,
  ])('turns %j into My applications', (value) => {
    expect(candidateSafeNext(value)).toBe(CANDIDATE_HOME);
  });
});

it('signInPath on the candidate sign-in page remembers where the candidate was going', () => {
  expect(signInPath('/candidates/me', '?tab=open', CANDIDATE_SIGN_IN)).toBe(
    '/candidates/sign-in?next=%2Fcandidates%2Fme%3Ftab%3Dopen',
  );
});
