import { defaultLocale, defaultTimeZone, getTranslations, intlConfig } from '@aivera/i18n';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CandidateSite } from './CandidateSite.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return { title: { template: t('candidate.shell.titleTemplate'), default: t('candidate.shell.siteTitle') } };
}

// The candidate site never reads the recruiter session (ADR-009: each surface reads only its own cookie).
export default async function CandidateLayout({ children }: { children: ReactNode }) {
  const intl = await intlConfig(defaultLocale, defaultTimeZone);
  // shortcut: always signed out until the candidate session exists (AIV-P0-011, sign-in AIV-P3-007); then read
  // `__Host-aivera-candidate` here and pass the result.
  return (
    <CandidateSite intl={intl} signedIn={false}>
      {children}
    </CandidateSite>
  );
}
