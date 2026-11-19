import { z } from 'zod';

// Recruiter sign-in rules (AIV-P0-009). Pure: no React, no I/O (ADR-003).

/** Where a signed-in recruiter lands: My desk. */
export const DESK = '/app';

const PROBE = 'http://aivera.invalid';

/**
 * Same-origin paths in the recruiter app only (`/app` and below): anything else (another origin, `//host`, `/\host`, a
 * scheme, another part of the site, a non-string) becomes the desk. The URL parser decides the origin; the normalised
 * path is checked again because removing dot segments (`/app/..//host`) can leave the recruiter app or the origin.
 */
export function safeNext(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return DESK;
  const url = URL.parse(value, PROBE);
  const path = url?.origin === PROBE ? `${url.pathname}${url.search}${url.hash}` : DESK;
  return /^\/app(?:[/?#]|$)/.test(path) ? path : DESK;
}

/**
 * The short-lived cookie that carries "Keep me signed in" through the round trip to the tenant (HTTP-only, never in a
 * URL); auth.ts reads it on the sign-in callback to choose the session length (apps/web/src/server/auth.ts).
 */
export const REMEMBER_COOKIE = '__Host-aivera-remember';

/** The sign-in page for a request that needs a session, remembering where it was going. */
export const signInPath = (pathname: string, search: string) =>
  `/sign-in?${new URLSearchParams({ next: `${pathname}${search}` })}`;

// Email with password and Google: what the recruiter user flow offers. A user flow has one email method (password,
// not one-time code), and Microsoft accounts cannot be added to it yet (docs/runbooks/recruiter-sign-in.md). `reset`
// is "Forgot password?": the same user flow, whose own "Forgot password?" link runs the tenant's password reset.
const METHODS = ['password', 'google', 'reset'] as const;

const signInForm = z
  .object({
    method: z.enum(METHODS),
    // A bad email only loses the hint; the tenant's page asks for it again.
    email: z.email().optional().catch(undefined),
    next: z.unknown().transform(safeNext),
    remember: z.unknown().transform((value) => value === 'on'),
  })
  // "Forgot password?" sends no email to the tenant (no login_hint in a URL, AGENTS.md 1.2).
  .transform((form) => (form.method === 'reset' ? { ...form, email: undefined } : form));

/** The posted sign-in form, validated (AGENTS.md 3.7). Throws on an unknown method. */
export const parseSignInForm = (form: FormData) =>
  signInForm.parse({
    method: form.get('method'),
    email: form.get('email') || undefined,
    next: form.get('next'),
    remember: form.get('remember'),
  });

/**
 * Authorisation request parameters for the External ID user flow. Every method opens the tenant's own page: email and
 * password are entered there (the app never sees a password), and Google is one click on it.
 * shortcut: no domain_hint for Google. On our tenant `google` is refused (AADSTS90023) and `google.com` skips sign-up
 * (AADSTS50020 for a first-time user), so "Continue with Google" costs one extra click; send `domain_hint=google` again
 * once it stops returning AADSTS90023 on the dev tenant.
 */
export function authorizationParams(email: string | undefined): Record<string, string> {
  // `prompt=login`: the tenant always asks for the password (or Google) again. Sign out ends only our session, so
  // without it the next person at a shared computer could land in the previous recruiter's account.
  // The recruiter's own email, sent only to our tenant to prefill its page; do not copy this for candidates (AIV-P0-011).
  return email ? { prompt: 'login', login_hint: email } : { prompt: 'login' };
}

type SignInError = 'unverifiedEmail' | 'unavailable' | 'failed';

/** The message key for `?error=`: ours by name, anything else from Auth.js or the tenant is a generic failure. */
export function signInError(value: string | string[] | undefined): SignInError | null {
  if (value === undefined) return null;
  if (value === 'unverified_email') return 'unverifiedEmail';
  if (value === 'unavailable') return 'unavailable';
  return 'failed';
}

/**
 * Where `/signup` sends a visitor (AIV-P1-059): with no tenant, the sign-in page's "not set up" message; signed in,
 * My desk (or the no-workspace page); otherwise null: the tenant's sign-up page, returning to My desk.
 */
export function signUpRedirect(configured: boolean, signedIn: boolean) {
  if (!configured) return '/sign-in?error=unavailable';
  return signedIn ? DESK : null;
}

// External ID opens its sign-up page for `prompt=create`; a tenant that ignores it shows the same user flow, which
// offers "Sign up". No login_hint: no URL in sign-up carries personal data.
export const SIGN_UP_PARAMS = { prompt: 'create' } as const;
