import { defaultLocale, defaultTimeZone, getTranslations } from '@aivera/i18n';
import type { Metadata } from 'next';
import { inkMark } from '@/features/sign-in/components/AuthPage.tsx';
import { SignInForm } from '@/features/sign-in/components/SignInForm.tsx';
import { safeNext, signInError } from '@/features/sign-in/domain/signIn.ts';
import { startSignIn } from '@/features/sign-in/services/startSignIn.ts';
import { googleConfigured } from '@/server/auth';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return { title: `${t('signIn.title')} · ${t('app.title')}` };
}

// Public: the recruiter sign-in page (AIV-P0-009). It renders even with no tenant configured, so the deploy keeps
// working; the action then answers "Sign-in is not set up in this environment yet."
export default async function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  const { next, error } = await searchParams;
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  const errorKey = signInError(error);
  return (
    <SignInForm
      action={startSignIn}
      next={safeNext(next)}
      error={errorKey && t(`signIn.errors.${errorKey}`)}
      google={googleConfigured()}
      labels={{
        wordmark: t('shell.wordmark'),
        headline: t.rich('signIn.headline', { mark: inkMark }),
        points: [t('signIn.points.cites'), t('signIn.points.claims'), t('signIn.points.people')],
        title: t('signIn.title'),
        lead: t('signIn.lead'),
        email: t('signIn.email'),
        passwordNote: t('signIn.passwordNote'),
        remember: t('signIn.remember'),
        signIn: t('signIn.signIn'),
        forgotPassword: t('signIn.forgotPassword'),
        or: t('signIn.or'),
        google: t('signIn.google'),
        newHere: t('signIn.newHere'),
        createWorkspace: t('signIn.createWorkspace'),
      }}
    />
  );
}
