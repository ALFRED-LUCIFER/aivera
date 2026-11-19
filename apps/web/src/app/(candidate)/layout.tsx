import { defaultLocale, defaultTimeZone, getTranslations, intlConfig } from '@aivera/i18n';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { candidateSignOut } from '@/features/candidate-sign-in/services/candidateSignOut.ts';
import { getCandidateSessionUserId } from '@/server/candidateAuth';
import { CandidateSite } from './CandidateSite.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return { title: { template: t('candidate.shell.titleTemplate'), default: t('candidate.shell.siteTitle') } };
}

// The candidate site reads only `__Host-aivera-candidate`, never the recruiter session (ADR-009, AIV-P0-011).
export default async function CandidateLayout({ children }: { children: ReactNode }) {
  const intl = await intlConfig(defaultLocale, defaultTimeZone);
  const signedIn = (await getCandidateSessionUserId()) !== null;
  return (
    <CandidateSite intl={intl} signedIn={signedIn} signOutAction={candidateSignOut}>
      {children}
    </CandidateSite>
  );
}
