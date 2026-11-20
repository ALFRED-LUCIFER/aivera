import NextAuth from 'next-auth';
import type { NextFetchEvent, NextRequest } from 'next/server';
import { CANDIDATE_SIGN_IN } from '@/features/candidate-sign-in/domain/candidateSignIn.ts';
import { authConfig, type SignInSide } from './auth';
import { env } from './env';

// Candidate sign-in (AIV-P0-011, ADR-009): the same External ID tenant as recruiters, through the candidate app
// registration and user flow, on a separate session. The same identity user (one per verified email) signs in on both
// sides, but neither side ever reads the other's cookie, and nothing here is exposed to recruiter-side code.

// shortcut: Auth.js's flow cookies (state, PKCE, nonce, callback URL) keep their default names on both sides, so two
// sign-ins started at once in one browser (one per side) make the first fail; prefix them per side if that is reported.
const CANDIDATE: SignInSide = {
  cookie: '__Host-credalent-candidate',
  basePath: '/api/candidate-auth',
  signInPage: CANDIDATE_SIGN_IN,
};

export const candidateAuthConfigured = (): boolean => env().candidateAuth !== null;

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const settings = env().candidateAuth;
  // Callers check candidateAuthConfigured() first; reaching here without settings is a bug, not a user error.
  if (!settings) throw new Error('Candidate sign-in is not configured.');
  // Never "Keep me signed in": that choice (and its cookie) belongs to the recruiter sign-in; candidates get 8 hours idle.
  return authConfig(settings, false, CANDIDATE);
});

/** The proxy form of `auth` for `/candidates/me`: no candidate session goes to the candidate sign-in (idle 8 hours). */
// next-auth's overloads do not type the (request, event) middleware call it supports at runtime.
export const candidateSessionProxy = auth as unknown as (
  request: NextRequest,
  event: NextFetchEvent,
) => Promise<Response>;

/** The signed-in candidate's identity user id, or null. Read only by candidate pages, never by recruiter code. */
export async function getCandidateSessionUserId(): Promise<string | null> {
  if (!candidateAuthConfigured()) return null;
  return (await auth())?.user?.id || null;
}
