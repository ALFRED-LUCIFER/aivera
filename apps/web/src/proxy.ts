import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { signInPath } from '@/features/sign-in/domain/signIn.ts';
import { authConfigured, sessionProxy } from '@/server/auth';

// The recruiter route group needs a session (AIV-P0-009). This is the optimistic redirect; the recruiter layout checks
// the session again on the server, and AIV-P0-010 adds workspace and role checks.
export function proxy(request: NextRequest, event: NextFetchEvent) {
  if (authConfigured()) return sessionProxy(request, event);
  // No tenant configured: no session can exist, so every recruiter page goes to sign-in (fails closed).
  return NextResponse.redirect(new URL(signInPath(request.nextUrl.pathname, request.nextUrl.search), request.url));
}

export const config = { matcher: ['/app/:path*'] };
