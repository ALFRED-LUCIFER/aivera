'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authConfigured, googleConfigured, signIn } from '@/server/auth';
import { publicEntry } from '@/server/publicEntry';
import { authorizationParams, parseSignInForm, rememberCookie } from '../domain/signIn';

/**
 * Starts the OIDC sign-in (there is no session yet): Google directly (AIV-P0-928), email and password at the
 * External ID tenant. Redirects with PKCE, state and nonce; the callback lands on the sanitised `next`, or the desk. "Keep me signed in" travels in a
 * short-lived HTTP-only cookie, like Auth.js's own state and PKCE cookies; unticked, it is cleared (max-age 0).
 */
export const startSignIn = publicEntry(
  'starts the OIDC sign-in; there is no session yet',
  async (form: FormData): Promise<void> => {
    const { method, email, next, remember } = parseSignInForm(form);
    const google = method === 'google';
    if (!authConfigured() || (google && !googleConfigured())) redirect('/sign-in?error=unavailable');
    (await cookies()).set(rememberCookie(remember));
    if (google) await signIn('google', { redirectTo: next });
    else await signIn('entra', { redirectTo: next }, authorizationParams(email));
  },
);
