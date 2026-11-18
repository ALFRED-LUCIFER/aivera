import { z } from 'zod';

// Recruiter sign-in rules (AIV-P0-009). Pure: no React, no I/O (ADR-003).

/** Where a signed-in recruiter lands: My desk. */
export const DESK = '/app';

const PROBE = 'http://aivera.invalid';

/**
 * Same-origin paths only: anything else (another origin, `//host`, `/\host`, a scheme, a non-string) becomes the desk.
 * The URL parser decides the origin; the result is checked again because removing dot segments (`/.//host`) can turn
 * a same-origin input into a protocol-relative `//host`.
 */
export function safeNext(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return DESK;
  const url = URL.parse(value, PROBE);
  const path = url?.origin === PROBE ? `${url.pathname}${url.search}${url.hash}` : DESK;
  return path.startsWith('//') ? DESK : path;
}

/** The sign-in page for a request that needs a session, remembering where it was going. */
export const signInPath = (pathname: string, search: string) =>
  `/sign-in?${new URLSearchParams({ next: `${pathname}${search}` })}`;

// Email with password and Google: what the recruiter user flow offers. A user flow has one email method (password,
// not one-time code), and Microsoft accounts cannot be added to it yet (docs/runbooks/recruiter-sign-in.md).
const METHODS = ['password', 'google'] as const;
export type Method = (typeof METHODS)[number];

const signInForm = z.object({
  method: z.enum(METHODS),
  // A bad email only loses the hint; the tenant's page asks for it again.
  email: z.email().optional().catch(undefined),
  next: z.unknown().transform(safeNext),
});

/** The posted sign-in form, validated (AGENTS.md 3.7). Throws on an unknown method. */
export const parseSignInForm = (form: FormData) =>
  signInForm.parse({
    method: form.get('method'),
    email: form.get('email') || undefined,
    next: form.get('next'),
  });

/**
 * Authorisation request parameters for the External ID user flow. Every method opens the tenant's own page: email and
 * password are entered there (the app never sees a password), and Google is one click on it.
 * shortcut: no domain_hint for Google. On our tenant `google` is refused (AADSTS90023) and `google.com` skips sign-up
 * (AADSTS50020 for a first-time user), so "Continue with Google" costs one extra click; retry a hint when Microsoft fixes it.
 */
export function authorizationParams(email: string | undefined): Record<string, string> {
  // The recruiter's own email, sent only to our tenant to prefill its page; do not copy this for candidates (AIV-P0-011).
  return email ? { login_hint: email } : {};
}

type SignInError = 'unverifiedEmail' | 'unavailable' | 'failed';

/** The message key for `?error=`: ours by name, anything else from Auth.js or the tenant is a generic failure. */
export function signInError(value: string | string[] | undefined): SignInError | null {
  if (value === undefined) return null;
  if (value === 'unverified_email') return 'unverifiedEmail';
  if (value === 'unavailable') return 'unavailable';
  return 'failed';
}
