import { redirect } from 'next/navigation';
import { DESK, SIGN_UP_PARAMS, signUpRedirect } from '@/features/sign-in/domain/signIn.ts';
import { authConfigured, getSessionUserId, signIn } from '@/server/auth';

// Public: the home page's "Create your workspace" (AIV-P1-059). A route handler, not a page, because starting the
// OIDC flow sets the PKCE, state and nonce cookies, which a Server Component render cannot.
export async function GET(): Promise<void> {
  const target = signUpRedirect(authConfigured(), (await getSessionUserId()) !== null);
  if (target) redirect(target);
  await signIn('entra', { redirectTo: DESK }, SIGN_UP_PARAMS);
}
