import { IdentityError, type IdentityContract } from '@aivera/identity';
import { createIdentity } from '@aivera/identity/composition';
import NextAuth, { customFetch, type AuthError, type NextAuthConfig } from 'next-auth';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { z } from 'zod';
import { signInPath } from '@/features/sign-in/domain/signIn.ts';
import { getDb } from './db';
import { env, type WebEnv } from './env';

// Recruiter sign-in (AIV-P0-009, ADR-009): one OIDC provider, the Entra External ID tenant's recruiter app
// registration. Email with password and Google are chosen on the tenant's user flow, never in this app, so the app
// never sees a password. The session is an encrypted JWT in an HTTP-only cookie holding only the identity user id.

const SESSION_COOKIE = '__Host-aivera-session';
const EIGHT_HOURS = 8 * 60 * 60;

// The ID token's claims, validated at the trust boundary (AGENTS.md 3.7). `email_verified` stays undefined when absent;
// identity decides what counts as verified (ADR-009 point 4).
const idTokenClaims = z.object({
  iss: z.string().min(1),
  sub: z.string().min(1),
  email: z.email(),
  email_verified: z.unknown().transform((v) => (v === undefined ? undefined : v === true)),
  name: z.string().min(1).optional(),
});

const isDiscovery = (input: string | URL | Request) =>
  (input instanceof Request ? input.url : String(input)).endsWith('/.well-known/openid-configuration');

let identity: IdentityContract | undefined;
/**
 * The app's one identity module instance (also used by the workspace context, AIV-P0-010). Our own tenant's issuer is
 * trusted without `email_verified`; with no tenant, none is.
 */
export const getIdentity = (): IdentityContract =>
  (identity ??= createIdentity(getDb(), { trustedIssuer: env().auth?.issuer ?? '' }));

export const authConfigured = (): boolean => env().auth !== null;

// Auth.js's stable `type` codes (the class name is minified in production); anything else is never echoed.
const AUTH_ERROR_TYPES: ReadonlySet<string> = new Set<AuthError['type'] | 'Configuration'>([
  'AccessDenied',
  'AccountNotLinked',
  'AdapterError',
  'CallbackRouteError',
  'Configuration',
  'CredentialsSignin',
  'DuplicateConditionalUI',
  'EmailSignInError',
  'ErrorPageLoop',
  'EventError',
  'ExperimentalFeatureNotEnabled',
  'InvalidCallbackUrl',
  'InvalidCheck',
  'InvalidEndpoints',
  'InvalidProvider',
  'JWTSessionError',
  'MissingAdapter',
  'MissingAdapterMethods',
  'MissingAuthorize',
  'MissingCSRF',
  'MissingSecret',
  'MissingWebAuthnAutocomplete',
  'OAuthAccountNotLinked',
  'OAuthCallbackError',
  'OAuthProfileParseError',
  'OAuthSignInError',
  'SessionTokenError',
  'SignOutError',
  'UnknownAction',
  'UnsupportedStrategy',
  'UntrustedHost',
  'Verification',
  'WebAuthnVerificationError',
]);

const authErrorCode = (error: Error): string => {
  const type: unknown = (error as { type?: unknown }).type;
  return typeof type === 'string' && AUTH_ERROR_TYPES.has(type) ? type : 'UnknownAuthError';
};

/** Exported for its test (auth.test.ts): the logger and the refusal path must never print personal data. */
export function authConfig(auth: NonNullable<WebEnv['auth']>): NextAuthConfig {
  return {
    secret: auth.secret,
    // Container Apps ingress sets the forwarded host; the app has no fixed public URL in dev.
    trustHost: true,
    providers: [
      {
        id: 'entra',
        name: 'Aivera',
        type: 'oidc',
        issuer: auth.issuer,
        clientId: auth.clientId,
        clientSecret: auth.clientSecret,
        authorization: { params: { scope: 'openid profile email' } },
        checks: ['pkce', 'state', 'nonce'],
        // Auth.js fetches metadata from `${issuer}/.well-known/...`; External ID serves it on the subdomain host.
        [customFetch]: (input: string | URL | Request, init?: RequestInit) =>
          fetch(isDiscovery(input) ? auth.discovery : input, init),
      },
    ],
    // Auth.js's default logger prints causes and details, which can carry an email (AGENTS.md 1.2): codes only.
    // shortcut: console until the app has a pino logger, AIV-P0-018 (#50); log through it then
    logger: {
      error: (error) => console.error(`[auth] ${authErrorCode(error)}`),
      warn: (code) => console.warn(`[auth] ${code}`),
    },
    pages: { signIn: '/sign-in', error: '/sign-in' },
    session: { strategy: 'jwt', maxAge: EIGHT_HOURS },
    cookies: {
      sessionToken: {
        name: SESSION_COOKIE,
        options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
      },
    },
    callbacks: {
      // The proxy's check (sessionProxy): no session goes to /sign-in, remembering where it was going.
      authorized: ({ request, auth: session }) =>
        Boolean(session?.user?.id) ||
        NextResponse.redirect(new URL(signInPath(request.nextUrl.pathname, request.nextUrl.search), request.url)),
      async signIn({ user, profile }) {
        const claims = idTokenClaims.safeParse(profile);
        if (!claims.success) return false;
        try {
          const found = await getIdentity().upsertUserFromIdToken({
            issuer: claims.data.iss,
            subject: claims.data.sub,
            email: claims.data.email,
            emailVerified: claims.data.email_verified,
            displayName: claims.data.name ?? null,
          });
          // Auth.js passes this same `user` object to the jwt callback below (no adapter), so the id travels on.
          user.id = found.id;
          return true;
        } catch (error) {
          if (error instanceof IdentityError) return `/sign-in?error=${error.code}`;
          throw error;
        }
      },
      // Only the identity user id goes into the cookie: no name, email or provider token.
      jwt: ({ token, user }) => (user?.id ? { sub: user.id } : token),
      session: ({ session, token }) => ({ expires: session.expires, user: { id: token.sub ?? '' } }),
    },
  };
}

export const { handlers, auth, signIn } = NextAuth(() => {
  const settings = env().auth;
  // Callers check authConfigured() first; reaching here without settings is a bug, not a user error.
  if (!settings) throw new Error('Recruiter sign-in is not configured.');
  return authConfig(settings);
});

/**
 * The proxy form of `auth`: runs the `authorized` callback above and re-issues the session cookie, so the 8-hour limit
 * counts from the last request (idle).
 */
// next-auth's overloads do not type the (request, event) middleware call it supports at runtime.
export const sessionProxy = auth as unknown as (request: NextRequest, event: NextFetchEvent) => Promise<Response>;

/** The signed-in user's identity id, or null. The one way server code learns who is signed in (AIV-P0-010 builds on it). */
export async function getSessionUserId(): Promise<string | null> {
  if (!authConfigured()) return null;
  return (await auth())?.user?.id || null;
}
