import { redirect } from 'next/navigation';
import { DESK, SIGN_UP_PARAMS, signUpStep } from '@/features/sign-in/domain/signIn.ts';
import { authConfigured, getSessionUserId, signIn } from '@/server/auth';

// Public: the home page's "Create your workspace" (AIV-P1-059). A route handler, not a page, because starting the
// OIDC flow sets the PKCE, state and nonce cookies, which a Server Component render cannot.
export async function GET(): Promise<never> {
  const step = signUpStep(authConfigured(), (await getSessionUserId()) !== null);
  if (step === 'tenant') await signIn('entra', { redirectTo: DESK }, SIGN_UP_PARAMS);
  redirect(step === 'desk' ? DESK : '/sign-in?error=unavailable');
}
