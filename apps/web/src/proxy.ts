import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { CANDIDATE_SIGN_IN } from '@/features/candidate-sign-in/domain/candidateSignIn.ts';
import { signInPath } from '@/features/sign-in/domain/signIn.ts';
import { authConfigured, sessionProxy } from '@/server/auth';
import { candidateAuthConfigured, candidateSessionProxy } from '@/server/candidateAuth';

// The recruiter route group needs a recruiter session (AIV-P0-009), and My applications a candidate session
// (AIV-P0-011). Each branch reads only its own side's cookie, so one side's session never opens the other's pages. This
// is the optimistic redirect; the recruiter layout checks the session again on the server, and AIV-P0-010 adds
// workspace and role checks.
export function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname, search } = request.nextUrl;
  const candidate = pathname.startsWith('/candidates/');
  if (candidate ? candidateAuthConfigured() : authConfigured())
    return (candidate ? candidateSessionProxy : sessionProxy)(request, event);
  // No settings for that side: no session can exist, so every protected page goes to its sign-in (fails closed).
  return NextResponse.redirect(
    new URL(signInPath(pathname, search, candidate ? CANDIDATE_SIGN_IN : undefined), request.url),
  );
}

export const config = { matcher: ['/app/:path*', '/candidates/me/:path*'] };
