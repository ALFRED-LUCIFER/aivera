import { describe, expect, it } from 'vitest';
import {
  authorizationParams,
  DESK,
  parseSignInForm,
  safeNext,
  signInError,
  signInPath,
  signUpRedirect,
} from './signIn';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe('safeNext (Scenario Outline: Return-to refuses anything outside the recruiter app)', () => {
  it.each(['/app', '/app/jobs', '/app/jobs?tab=open#top'])('keeps the same-origin path %s', (path) => {
    expect(safeNext(path)).toBe(path);
  });

  // SAFETY: mutation check: returned `value` unchanged after the startsWith('/') check -> the //, /\ and tab cases failed
  // SAFETY: mutation check: replaced the final /app check with `!path.startsWith('//')` (any same-origin path) -> the
  // /candidates/jobs, /apples and /app/.. cases failed
  it.each([
    'https://evil.example',
    '/candidates/jobs',
    '/',
    '/apples',
    '/app/../candidates',
    '/app/..//evil.example',
    '//evil.example/app',
    '/\\evil.example',
    '/\t/evil.example',
    'javascript:alert(1)',
    'app',
    '',
    '//[',
    '/.//evil.example',
    '/a/..//evil.example',
    '/%2e//evil.example',
    '/.\\/evil.example',
  ])('turns %j into the desk', (value) => {
    expect(safeNext(value)).toBe(DESK);
  });

  it('turns a missing or non-string value into the desk', () => {
    expect(safeNext(null)).toBe(DESK);
    expect(safeNext(undefined)).toBe(DESK);
  });
});

describe('sign-in form and request', () => {
  it('builds the sign-in path that remembers where the request was going', () => {
    expect(new URLSearchParams(signInPath('/app/jobs', '?tab=open').split('?')[1]).get('next')).toBe(
      '/app/jobs?tab=open',
    );
  });

  it('validates the posted form and sanitises next', () => {
    expect(parseSignInForm(form({ method: 'google', email: 'nadia@example.com', next: '//evil.example' }))).toEqual({
      method: 'google',
      email: 'nadia@example.com',
      next: DESK,
      remember: false,
    });
    expect(parseSignInForm(form({ method: 'password', remember: 'on' })).remember).toBe(true);
    expect(
      parseSignInForm(form({ method: 'password', email: 'not an email', next: '/app/jobs' })).email,
    ).toBeUndefined();
    expect(() => parseSignInForm(form({ method: 'sso' }))).toThrow();
  });

  it('sends only the typed email to the tenant page, for every method', () => {
    expect(authorizationParams('alex@example.com')).toEqual({ login_hint: 'alex@example.com' });
    expect(authorizationParams(undefined)).toEqual({});
  });

  // Scenario: Forgot password opens the tenant's reset without my email in the URL.
  // SAFETY: mutation check: removed the `method === 'reset'` transform (email kept) -> this test failed
  it('"Forgot password?" sends no login_hint, even with an email typed', () => {
    const { method, email } = parseSignInForm(form({ method: 'reset', email: 'nadia@example.com', next: '/app' }));
    expect(method).toBe('reset');
    expect(authorizationParams(email)).toEqual({});
  });

  it('refuses the methods the user flow does not offer', () => {
    for (const method of ['code', 'microsoft']) expect(() => parseSignInForm(form({ method }))).toThrow();
  });

  it('maps error codes to messages, and anything unknown to a generic failure', () => {
    expect(signInError(undefined)).toBeNull();
    expect(signInError('unverified_email')).toBe('unverifiedEmail');
    expect(signInError('unavailable')).toBe('unavailable');
    expect(signInError('AccessDenied')).toBe('failed');
  });
});

describe('signUpRedirect (AIV-P1-059)', () => {
  // SAFETY: mutation check: checked signedIn before configured -> the not-configured signed-in case failed
  it.each([
    [false, false, '/sign-in?error=unavailable'],
    [false, true, '/sign-in?error=unavailable'],
    [true, true, DESK],
    [true, false, null],
  ] as const)('configured %s, signed in %s: %s', (configured, signedIn, target) => {
    expect(signUpRedirect(configured, signedIn)).toBe(target);
  });
});
