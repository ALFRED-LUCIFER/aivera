'use server';

import { redirect } from 'next/navigation';
import { authConfigured, signIn } from '@/server/auth';
import { authorizationParams, parseSignInForm } from '../domain/signIn';

/**
 * Public: starts the OIDC sign-in at the External ID tenant (there is no session yet). Redirects to the tenant with
 * PKCE, state and nonce; the callback lands on the sanitised `next`, or the desk.
 */
export async function startSignIn(form: FormData): Promise<void> {
  const { email, next } = parseSignInForm(form);
  if (!authConfigured()) redirect('/sign-in?error=unavailable');
  await signIn('entra', { redirectTo: next }, authorizationParams(email));
}
