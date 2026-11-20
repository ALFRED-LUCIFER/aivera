'use server';

import { CandidateAccountError } from '@aivera/candidate-accounts';
import { log } from '@aivera/observability';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { CANDIDATE_SIGN_IN } from '@/features/candidate-sign-in/domain/candidateSignIn.ts';
import { getCandidateAccounts } from '@/server/candidateAccounts';
import { getCandidateSessionUserId } from '@/server/candidateAuth';
import { getCatalogue } from '@/server/jobs';
import { parseSignUpForm, signUpNext, type SignUpState } from '../domain/signup.ts';

/**
 * Candidate session only: records the full name and work type on the signed-in candidate's account and lands where the
 * candidate was going (the sanitised `next`), else My applications. The account is always the session user's, never
 * an id from the form.
 */
export async function completeSignUp(_previous: SignUpState, form: FormData): Promise<SignUpState> {
  const userId = await getCandidateSessionUserId();
  if (!userId) redirect(CANDIDATE_SIGN_IN);
  let catalogue;
  try {
    catalogue = await getCatalogue().getPublishedCatalogue();
  } catch (error) {
    log.error({ area: 'candidate-signup', 'error.type': error instanceof Error ? error.name : 'unknown' }, 'catalogue');
    const values = { fullName: String(form.get('fullName') ?? ''), workType: String(form.get('workType') ?? '') };
    return { errors: {}, failed: true, values };
  }
  const parsed = parseSignUpForm(form, catalogue);
  if (!('input' in parsed)) return parsed;
  const accounts = getCandidateAccounts();
  try {
    await accounts.withAccount(userId, (ctx) => accounts.signUp(ctx, parsed.input));
  } catch (error) {
    // Signed up already (another tab, a double submit): nothing changed, so carry on to where they were going.
    if (!(error instanceof CandidateAccountError && error.code === 'already_signed_up')) {
      // The name only: a database error's detail can repeat the full name (AGENTS.md 1.2).
      log.error({ area: 'candidate-signup', 'error.type': error instanceof Error ? error.name : 'unknown' }, 'failed');
      return { errors: {}, failed: true, values: parsed.input };
    }
  }
  // A sanitised candidate path, which typed routes cannot see.
  redirect(signUpNext(form.get('next')) as Route);
}
