import { describe, expect, it } from 'vitest';
import { authorizationParams, DESK, parseSignInForm, safeNext, signInError, signInPath } from './signIn';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe('safeNext (Scenario: Open redirects are refused)', () => {
  it.each(['/app', '/app/jobs', '/app/jobs?tab=open#top'])('keeps the same-origin path %s', (path) => {
    expect(safeNext(path)).toBe(path);
  });

  // SAFETY: mutation check: returned `value` unchanged after the startsWith('/') check -> the //, /\ and tab cases failed
  it.each([
    'https://evil.example',
    '//evil.example/app',
    '/\\evil.example',
    '/\t/evil.example',
    'javascript:alert(1)',
    'app',
    '',
    '//[',
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
    });
    expect(
      parseSignInForm(form({ method: 'password', email: 'not an email', next: '/app/jobs' })).email,
    ).toBeUndefined();
    expect(() => parseSignInForm(form({ method: 'sso' }))).toThrow();
  });

  it('sends Google and Microsoft straight to their provider, and email methods to the tenant page', () => {
    expect(authorizationParams('google', undefined)).toEqual({ domain_hint: 'google' });
    expect(authorizationParams('microsoft', 'alex@example.com')).toEqual({
      login_hint: 'alex@example.com',
      domain_hint: 'login.microsoftonline.com',
    });
    expect(authorizationParams('password', 'alex@example.com')).toEqual({ login_hint: 'alex@example.com' });
    expect(authorizationParams('code', undefined)).toEqual({});
  });

  it('maps error codes to messages, and anything unknown to a generic failure', () => {
    expect(signInError(undefined)).toBeNull();
    expect(signInError('unverified_email')).toBe('unverifiedEmail');
    expect(signInError('unavailable')).toBe('unavailable');
    expect(signInError('AccessDenied')).toBe('failed');
  });
});
