import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import { JOB_TYPES } from '@aivera/jobs';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CANDIDATE_SIGN_UP, PLUS_SIGN_UP_FLAG, signUpStep } from '@/features/candidate-account/domain/signup.ts';
import { CANDIDATE_HOME } from '@/features/candidate-sign-in/domain/candidateSignIn.ts';
import { startCandidateSignIn } from '@/features/candidate-sign-in/services/startCandidateSignIn.ts';
import { getCandidateAccounts, identityDisplayName } from '@/server/candidateAccounts';
import { getCandidateSessionUserId } from '@/server/candidateAuth';
import { enabledFlags } from '@/server/flags';
import { SignUpView } from './SignUpView.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations(defaultLocale, defaultTimeZone))('candidate.signup.title') };
}

// Public when signed out (the sign-up panel); with a candidate session, the session user's own account only (AIV-P3-007).
export default async function CandidateSignUpPage() {
  const userId = await getCandidateSessionUserId();
  const accounts = getCandidateAccounts();
  const account = userId ? await accounts.withAccount(userId, (ctx) => accounts.getMyAccount(ctx)) : null;
  const step = signUpStep(userId, account);
  if (step === 'done') redirect(CANDIDATE_HOME);
  // Prefilled from the tenant's display name until the candidate chooses one.
  const fullName = account ? (account.fullName ?? (await identityDisplayName(account.id)) ?? '') : '';
  return (
    <SignUpView
      step={step}
      startAction={startCandidateSignIn}
      next={CANDIDATE_SIGN_UP}
      workTypes={JOB_TYPES}
      plusEnabled={enabledFlags.has(PLUS_SIGN_UP_FLAG)}
      fullName={fullName}
    />
  );
}
