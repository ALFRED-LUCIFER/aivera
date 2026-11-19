import { defaultLocale, defaultTimeZone, formatMoney, getTranslations } from '@aivera/i18n';
import { JOB_TYPES } from '@aivera/jobs';
import type { Metadata, Route } from 'next';
import { redirect } from 'next/navigation';
import { PLUS_SIGN_UP_FLAG, signUpNext, signUpStep } from '@/features/candidate-account/domain/signup.ts';
import { PLUS_MONTHLY_PRICE } from '@/features/candidate-shell/domain/plus.ts';
import { startCandidateSignIn } from '@/features/candidate-sign-in/services/startCandidateSignIn.ts';
import { getCandidateAccounts, identityDisplayName } from '@/server/candidateAccounts';
import { getCandidateSessionUserId } from '@/server/candidateAuth';
import { enabledFlags } from '@/server/flags';
import { SignUpView } from './SignUpView.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations(defaultLocale, defaultTimeZone))('candidate.signup.title') };
}

// Public when signed out (the sign-up panel); with a candidate session, the session user's own account only (AIV-P3-007).
export default async function CandidateSignUpPage({ searchParams }: PageProps<'/candidates/signup'>) {
  const next = signUpNext((await searchParams).next);
  const userId = await getCandidateSessionUserId();
  const accounts = getCandidateAccounts();
  const account = userId ? await accounts.withAccount(userId, (ctx) => accounts.getMyAccount(ctx)) : null;
  const step = signUpStep(userId, account);
  // A sanitised candidate path (signUpNext), which typed routes cannot see.
  if (step === 'done') redirect(next as Route);
  // Prefilled from the tenant's display name until the candidate chooses one.
  const fullName = account ? (account.fullName ?? (await identityDisplayName(account.id)) ?? '') : '';
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return (
    <SignUpView
      step={step}
      startAction={startCandidateSignIn}
      next={next}
      workTypes={JOB_TYPES}
      plusEnabled={enabledFlags.has(PLUS_SIGN_UP_FLAG)}
      plusPrice={t('money.monthly', { amount: formatMoney(PLUS_MONTHLY_PRICE, defaultLocale) })}
      fullName={fullName}
    />
  );
}
