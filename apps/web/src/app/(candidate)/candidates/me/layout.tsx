import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { CANDIDATE_SIGN_IN } from '@/features/candidate-sign-in/domain/candidateSignIn.ts';
import { getCandidateSessionUserId } from '@/server/candidateAuth';

// My applications needs a candidate session (AIV-P0-011): the proxy redirects first, this checks again on the server.
export default async function CandidateMeLayout({ children }: { children: ReactNode }) {
  if (!(await getCandidateSessionUserId())) redirect(CANDIDATE_SIGN_IN);
  return children;
}
