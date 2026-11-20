'use server';

import { redirect } from 'next/navigation';
import { candidateAuthConfigured, signIn } from '@/server/candidateAuth';
import { publicEntry } from '@/server/publicEntry';
import { CANDIDATE_SIGN_IN, candidateSafeNext } from '../domain/candidateSignIn';

/**
 * Starts the candidate OIDC sign-in at the External ID tenant (there is no session yet). Both buttons open the
 * candidate user flow, where email with password and Google are chosen. No `login_hint`: the candidate's email never
 * goes into a URL (AGENTS.md 1.2), and nothing posted is forwarded to the tenant except the sanitised `next`.
 * `prompt=login`, as on the recruiter side: sign out ends only our session, so on a shared computer the tenant must ask
 * again rather than sign the next person in silently.
 */
export const startCandidateSignIn = publicEntry(
  'starts the candidate OIDC sign-in; there is no session yet',
  async (form: FormData): Promise<void> => {
    const next = candidateSafeNext(form.get('next'));
    if (!candidateAuthConfigured()) redirect(`${CANDIDATE_SIGN_IN}?error=unavailable`);
    await signIn('entra', { redirectTo: next }, { prompt: 'login' });
  },
);
