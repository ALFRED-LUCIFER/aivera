import { isSignedUp } from '@credalent/candidate-accounts';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { CANDIDATE_SIGN_UP } from '@/features/candidate-account/domain/signup.ts';
import { CANDIDATE_SIGN_IN } from '@/features/candidate-sign-in/domain/candidateSignIn.ts';
import { getCandidateAccounts } from '@/server/candidateAccounts';
import { getCandidateSessionUserId } from '@/server/candidateAuth';

// My applications needs a candidate session (AIV-P0-011): the proxy redirects first, this checks again on the server.
// A signed-in person who has not given their full name and kind of work yet finishes sign-up first (AIV-P3-007).
// shortcut: only My applications checks this; a sign-in with `next` to another candidate page skips it. AIV-P3-008
// (apply) must check isSignedUp and send a person who is not signed up to signUpHref(<its path>), which returns them
// there; so must every later page that needs the profile.
export default async function CandidateMeLayout({ children }: { children: ReactNode }) {
  const userId = await getCandidateSessionUserId();
  if (!userId) redirect(CANDIDATE_SIGN_IN);
  const accounts = getCandidateAccounts();
  if (!isSignedUp(await accounts.withAccount(userId, (ctx) => accounts.getMyAccount(ctx)))) redirect(CANDIDATE_SIGN_UP);
  return children;
}
