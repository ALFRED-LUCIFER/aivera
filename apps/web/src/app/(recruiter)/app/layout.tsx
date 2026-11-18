import { defaultLocale, defaultTimeZone, getTranslations, intlConfig } from '@aivera/i18n';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { canOpen, navigation } from '@/features/shell/domain/navigation.ts';
import { devStandInMember, enabledFlags, loadShellCounts, readTheme } from '@/features/shell/services/request.ts';
import { getSessionUserId } from '@/server/auth';
import { RecruiterShell } from './RecruiterShell.tsx';

// Each section page sets its own title ("Inbox · Aivera", WCAG 2.4.2).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations(defaultLocale, defaultTimeZone);
  return { title: { template: t('shell.titleTemplate'), default: t('app.title') } };
}

export default async function RecruiterLayout({ children }: { children: ReactNode }) {
  // The server-side session check behind the proxy's redirect (AIV-P0-009); AIV-P0-010 resolves the member from it.
  if (!(await getSessionUserId())) redirect('/sign-in');
  const member = devStandInMember();
  if (!member) notFound();
  const [counts, theme, intl] = await Promise.all([
    loadShellCounts(member),
    readTheme(),
    intlConfig(defaultLocale, defaultTimeZone),
  ]);
  return (
    <RecruiterShell
      intl={intl}
      member={member}
      counts={counts}
      theme={theme}
      screens={navigation.filter((screen) => canOpen(screen, member.capabilities, enabledFlags))}
    >
      {children}
    </RecruiterShell>
  );
}
