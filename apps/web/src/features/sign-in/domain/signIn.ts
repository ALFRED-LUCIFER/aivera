import { z } from 'zod';

// Recruiter sign-in rules (AIV-P0-009). Pure: no React, no I/O (ADR-003).

/** Where a signed-in recruiter lands: My desk. */
export const DESK = '/app';

const PROBE = 'http://credalent.invalid';

/**
 * Same-origin paths in the recruiter app, the operator console (`/app`, `/ops` and below, AIV-P2-035) or an invitation
 * link (`/invite`, AIV-P1-003) only: anything
 * else (another origin, `//host`, `/\host`, a scheme, another part of the site, a non-string) becomes the desk. The URL
 * parser decides the origin; the normalised path is checked again because removing dot segments (`/app/..//host`) can
 * leave the recruiter app or the origin.
 */
export function safeNext(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return DESK;
  const url = URL.parse(value, PROBE);
  const path = url?.origin === PROBE ? `${url.pathname}${url.search}${url.hash}` : DESK;
  return /^\/(?:app|ops|invite)(?:[/?#]|$)/.test(path) ? path : DESK;
}

/**
 * The short-lived cookie that carries "Keep me signed in" through the round trip to the tenant (HTTP-only, never in a
 * URL); auth.ts reads it on the sign-in callback to choose the session length (apps/web/src/server/auth.ts).
 */
export const REMEMBER_COOKIE = '__Host-credalent-remember';

/** That cookie, set for 15 minutes when ticked, or cleared (max-age 0). Every way into the tenant sets it. */
export const rememberCookie = (remember: boolean) => ({
  name: REMEMBER_COOKIE,
  value: remember ? '1' : '',
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: remember ? 15 * 60 : 0,
});

/** The sign-in page for a request that needs a session, remembering where it was going. */
export const signInPath = (pathname: string, search: string, page = '/sign-in') =>
  `${page}?${new URLSearchParams({ next: `${pathname}${search}` })}`;

// Email with password (the recruiter user flow) and Google (direct, AIV-P0-928). A user flow has one email method
// (password, not one-time code), and Microsoft accounts cannot be added to it yet (docs/runbooks/recruiter-sign-in.md). `reset`
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
 * Authorisation request parameters for the External ID user flow: email and password are entered on the tenant's own
 * page, so the app never sees a password. Google does not use the tenant (AIV-P0-928, startSignIn).
 */
export function authorizationParams(email: string | undefined): Record<string, string> {
  // `prompt=login`: the tenant always asks for the password again. Sign out ends only our session, so
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
