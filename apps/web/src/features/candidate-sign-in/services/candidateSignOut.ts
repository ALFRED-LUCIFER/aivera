'use server';

import { redirect } from 'next/navigation';
import { candidateAuthConfigured, signOut } from '@/server/candidateAuth';
import { publicEntry } from '@/server/publicEntry';
import { CANDIDATE_SIGN_IN } from '../domain/candidateSignIn';

/**
 * Ends only the caller's own candidate session (clears `__Host-credalent-candidate`, never the recruiter cookie)
 * and lands on the candidate sign-in page. The next sign-in asks again at the tenant (prompt=login).
 */
export const candidateSignOut = publicEntry("ends only the caller's own candidate session", async (): Promise<void> => {
  // With no candidate settings there is no candidate session to end.
  if (!candidateAuthConfigured()) redirect(CANDIDATE_SIGN_IN);
  await signOut({ redirectTo: CANDIDATE_SIGN_IN });
});
