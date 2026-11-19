'use server';

import { redirect } from 'next/navigation';
import { candidateAuthConfigured, signOut } from '@/server/candidateAuth';
import { CANDIDATE_SIGN_IN } from '../domain/candidateSignIn';

/**
 * Public: ends only the caller's own candidate session (clears `__Host-aivera-candidate`, never the recruiter cookie)
 * and lands on the candidate sign-in page. The next sign-in asks again at the tenant (prompt=login).
 */
export async function candidateSignOut(): Promise<void> {
  // With no candidate settings there is no candidate session to end.
  if (!candidateAuthConfigured()) redirect(CANDIDATE_SIGN_IN);
  await signOut({ redirectTo: CANDIDATE_SIGN_IN });
}
