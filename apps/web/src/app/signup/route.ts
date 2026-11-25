import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DESK, rememberCookie, SIGN_UP_PARAMS, signUpRedirect } from '@/features/sign-in/domain/signIn.ts';
import { authConfigured, getSessionUserId, signIn } from '@/server/auth';
import { publicEntry } from '@/server/publicEntry';

// The home page's "Create your workspace" (AIV-P1-059). A route handler, not a page, because starting the OIDC flow
// sets the PKCE, state and nonce cookies, which a Server Component render cannot.
export const GET = publicEntry(
  'starts the OIDC sign-up; a signed-in user is only redirected to the desk',
  async (request: Request): Promise<Response | undefined> => {
    // A link prefetch is a fetch, not a navigation, and a browser prerender says so in Sec-Purpose. Starting the flow
    // for either overwrites the PKCE, state and nonce cookies of a sign-in already at the tenant, whose callback then
    // fails (AIV-P0-009, seen on Azure dev).
    const mode = request.headers.get('sec-fetch-mode');
    const speculative = request.headers.get('sec-purpose')?.includes('prefetch');
    if ((mode && mode !== 'navigate') || speculative) return new Response(null, { status: 204 });
    const target = signUpRedirect(authConfigured(), (await getSessionUserId()) !== null);
    if (target) redirect(target);
    // A "Keep me signed in" left by an earlier sign-in on this browser must not give this sign-up a 30-day session.
    (await cookies()).set(rememberCookie(false));
    await signIn('entra', { redirectTo: DESK }, SIGN_UP_PARAMS);
    return undefined; // Not reached: signIn redirects by throwing.
  },
);
