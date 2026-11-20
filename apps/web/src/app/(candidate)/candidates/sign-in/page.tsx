import { defaultLocale, defaultTimeZone, getTranslations } from '@credalent/i18n';
import type { Metadata } from 'next';
import { CandidateSignInForm } from '@/features/candidate-sign-in/components/CandidateSignInForm.tsx';
import { candidateSafeNext } from '@/features/candidate-sign-in/domain/candidateSignIn.ts';
import { startCandidateSignIn } from '@/features/candidate-sign-in/services/startCandidateSignIn.ts';
import { signInError } from '@/features/sign-in/domain/signIn.ts';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations(defaultLocale, defaultTimeZone))('signIn.title') };
}

// Public: the candidate sign-in page (AIV-P0-011). It renders with no candidate settings too; the action then answers
// "Sign-in is not set up in this environment yet."
export default async function CandidateSignInPage({ searchParams }: PageProps<'/candidates/sign-in'>) {
  const { next, error } = await searchParams;
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  const errorKey = signInError(error);
  return (
    <CandidateSignInForm
      action={startCandidateSignIn}
      next={candidateSafeNext(next)}
      error={errorKey && t(`signIn.errors.${errorKey}`)}
      labels={{
        title: t('signIn.title'),
        signIn: t('signIn.signIn'),
        or: t('signIn.or'),
        google: t('signIn.google'),
        noAccount: t('candidate.signIn.noAccount'),
        createAccount: t('candidate.signIn.createAccount'),
      }}
    />
  );
}
