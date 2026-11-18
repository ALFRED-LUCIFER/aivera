import { z } from 'zod';

// Recruiter sign-in rules (AIV-P0-009). Pure: no React, no I/O (ADR-003).

/** Where a signed-in recruiter lands: My desk. */
export const DESK = '/app';

const PROBE = 'http://aivera.invalid';

/**
 * Same-origin paths only: anything else (another origin, `//host`, `/\host`, a scheme, a non-string) becomes the desk.
 * The URL parser decides, so every spelling the browser would follow off-site is caught by the origin check.
 */
export function safeNext(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return DESK;
  const url = URL.parse(value, PROBE);
  return url?.origin === PROBE ? `${url.pathname}${url.search}${url.hash}` : DESK;
}

/** The sign-in page for a request that needs a session, remembering where it was going. */
export const signInPath = (pathname: string, search: string) =>
  `/sign-in?${new URLSearchParams({ next: `${pathname}${search}` })}`;

export const METHODS = ['password', 'code', 'google', 'microsoft'] as const;
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
 * Authorisation request parameters for the External ID user flow. `domain_hint` skips the tenant's picker straight to
 * Google, or to the Microsoft account provider (a custom OIDC provider whose issuer host is login.microsoftonline.com).
 * Email with password and email one-time code both happen on the tenant's own page, so the app never sees a password.
 */
// shortcut: "code" opens the password user flow, since an External ID user flow offers one email method (runbook "Password or code"); until the product decision on one-time-code sign-in
export function authorizationParams(method: Method, email: string | undefined): Record<string, string> {
  const hint: Record<string, string> = email ? { login_hint: email } : {};
  if (method === 'google') return { ...hint, domain_hint: 'google' };
  if (method === 'microsoft') return { ...hint, domain_hint: 'login.microsoftonline.com' };
  return hint;
}

export type SignInError = 'unverifiedEmail' | 'unavailable' | 'failed';

/** The message key for `?error=`: ours by name, anything else from Auth.js or the tenant is a generic failure. */
export function signInError(value: string | string[] | undefined): SignInError | null {
  if (value === undefined) return null;
  if (value === 'unverified_email') return 'unverifiedEmail';
  if (value === 'unavailable') return 'unavailable';
  return 'failed';
}
