import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DESK, rememberCookie, SIGN_UP_PARAMS, signUpRedirect } from '@/features/sign-in/domain/signIn.ts';
import { authConfigured, getSessionUserId, signIn } from '@/server/auth';

// Public: the home page's "Create your workspace" (AIV-P1-059). A route handler, not a page, because starting the
// OIDC flow sets the PKCE, state and nonce cookies, which a Server Component render cannot.
export async function GET(): Promise<void> {
  const target = signUpRedirect(authConfigured(), (await getSessionUserId()) !== null);
  if (target) redirect(target);
  // A "Keep me signed in" left by an earlier sign-in on this browser must not give this sign-up a 30-day session.
  (await cookies()).set(rememberCookie(false));
  await signIn('entra', { redirectTo: DESK }, SIGN_UP_PARAMS);
}
